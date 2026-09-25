# EduGrade - Secure Classroom Grade Management System
# Copyright (C) 2026 Fabian Murauer
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program. If not, see <https://www.gnu.org/licenses/>.


"""
EduGrade - Quart Backend Application
Main application with all API routes
JSON-based database implementation
"""

import json
import hashlib
import secrets
import functools
import base64
import os
import time
import smtplib
import asyncio
import logging
import db as db_layer
import docs_render
import webuntis_client
import moodle_client
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
from pathlib import Path
from datetime import datetime, timedelta
from collections import defaultdict
from quart import Quart, render_template, request, jsonify, redirect, url_for, make_response, send_file
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from io import BytesIO
import base64 as b64

# Try to import qrcode, but make it optional
try:
    import qrcode
    QR_CODE_AVAILABLE = True
except ImportError:
    QR_CODE_AVAILABLE = False
    print("Warning: qrcode library not available. QR code generation will not work.")

# Try to import reportlab for PDF generation
try:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch, cm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, Table, TableStyle, HRFlowable
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
    REPORTLAB_AVAILABLE = True
except ImportError:
    REPORTLAB_AVAILABLE = False
    print("Warning: reportlab library not available. PDF generation will not work.")

# ============ LOGGING ============

# Use a proper logger instead of print(). Set log level via LOG_LEVEL env var.
logging.basicConfig(
    level=os.environ.get('LOG_LEVEL', 'INFO').upper(),
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger('edugrade')


def _scrub_email(email: str) -> str:
    """Redact most of an email address to keep PII out of logs.
    'alice@example.com' -> 'a***@example.com'
    """
    if not email or '@' not in email:
        return '***'
    local, _, domain = email.partition('@')
    if not local:
        return f'***@{domain}'
    return f'{local[0]}***@{domain}'


# ============ RATE LIMITING ============

# Rate limit storage: {ip: {endpoint: [(timestamp, count)]}}
rate_limit_storage = defaultdict(lambda: defaultdict(list))

# Per-share-token failed-PIN tracking (in addition to per-IP rate limiting), so a
# distributed brute-force with rotating IPs against one public share link still
# hits a share-level wall. {share_token: [failure_timestamps]}
# ponytail: in-memory, per-process; fine for single-worker. Move to the DB/Redis
# if scaled to multiple workers.
share_pin_failures = defaultdict(list)
SHARE_PIN_MAX_FAILURES = 20        # per window, across all IPs
SHARE_PIN_WINDOW_SECONDS = 900     # 15 min


def share_pin_locked(share_token: str) -> bool:
    """True if this share has too many recent failed PIN attempts."""
    now = datetime.now()
    window_start = now - timedelta(seconds=SHARE_PIN_WINDOW_SECONDS)
    recent = [ts for ts in share_pin_failures[share_token] if ts > window_start]
    share_pin_failures[share_token] = recent
    return len(recent) >= SHARE_PIN_MAX_FAILURES


def record_share_pin_failure(share_token: str) -> None:
    share_pin_failures[share_token].append(datetime.now())

# Rate limit configurations: {endpoint_pattern: (max_requests, time_window_seconds)}
RATE_LIMITS = {
    'login': (5, 60),           # 5 attempts per minute
    'register': (3, 60),        # 3 attempts per minute
    'data_write': (120, 60),    # 120 writes per minute (granular per-class saves)
    'data_read': (240, 60),     # 240 reads per minute (granular per-class loads)
    'pin_verify': (5, 60),      # 5 PIN attempts per minute
    'share_manage': (20, 60),   # 20 share management requests per minute
    'password_reset': (3, 300), # 3 attempts per 5 minutes
    'org_join': (5, 60),        # 5 join-code attempts per minute (brute-force resistance)
    'org_manage': (20, 60),     # 20 org management requests per minute
    'webuntis_connect': (5, 60),  # 5 WebUntis login attempts per minute (brute-force resistance)
    'moodle_connect': (5, 60),    # 5 Moodle connect attempts per minute (brute-force resistance)
    'default': (100, 60),       # 100 requests per minute default
}

# Only honor X-Forwarded-For when running behind a trusted reverse proxy.
# Otherwise it is attacker-controlled and lets clients spoof their source IP
# to bypass per-IP rate limits. Set TRUSTED_PROXY=1 in your env when fronted
# by a TLS-terminating proxy (nginx, Caddy, Traefik).
TRUSTED_PROXY = os.environ.get('TRUSTED_PROXY', '').lower() in ('1', 'true', 'yes')

# Cookies are Secure (HTTPS-only) by default. Set COOKIE_SECURE=0 ONLY for local
# plain-HTTP development — never in production, or the session cookie can leak
# over cleartext HTTP.
COOKIE_SECURE = os.environ.get('COOKIE_SECURE', '1').lower() not in ('0', 'false', 'no')

def get_client_ip():
    """Get client IP from request, only trusting X-Forwarded-For behind a trusted proxy."""
    if TRUSTED_PROXY:
        forwarded = request.headers.get('X-Forwarded-For', '')
        if forwarded:
            # Use the LAST hop (set by our proxy) — earlier values are client-supplied and untrusted.
            return forwarded.split(',')[-1].strip()
    return request.remote_addr or 'unknown'

def check_rate_limit(endpoint_type: str = 'default') -> tuple[bool, int]:
    """
    Check if request is within rate limit.
    Returns (is_allowed, seconds_until_reset)
    """
    ip = get_client_ip()
    max_requests, time_window = RATE_LIMITS.get(endpoint_type, RATE_LIMITS['default'])
    now = datetime.now()
    window_start = now - timedelta(seconds=time_window)

    # Clean old entries and count recent requests
    recent_requests = [ts for ts in rate_limit_storage[ip][endpoint_type] if ts > window_start]
    rate_limit_storage[ip][endpoint_type] = recent_requests

    if len(recent_requests) >= max_requests:
        # Calculate time until oldest request expires
        oldest = min(recent_requests)
        seconds_until_reset = int((oldest + timedelta(seconds=time_window) - now).total_seconds()) + 1
        return False, seconds_until_reset

    # Add current request
    rate_limit_storage[ip][endpoint_type].append(now)
    return True, 0

def rate_limit(endpoint_type: str = 'default'):
    """Decorator to apply rate limiting to routes"""
    def decorator(f):
        @functools.wraps(f)
        async def decorated_function(*args, **kwargs):
            is_allowed, seconds_until_reset = check_rate_limit(endpoint_type)
            if not is_allowed:
                return jsonify({
                    'success': False,
                    'message': 'backend.tooManyRequests',
                    'message_params': {'seconds': seconds_until_reset},
                    'rate_limited': True,
                    'retry_after': seconds_until_reset
                }), 429
            return await f(*args, **kwargs)
        decorated_function.__name__ = f"{f.__name__}_rate_limited"
        return decorated_function
    return decorator

# ============ JSON DATABASE IMPLEMENTATION ============

# Database path
DATA_DIR = Path(__file__).parent / "data"
CONFIG_PATH = DATA_DIR / "config.json"

# Ensure data directory exists
DATA_DIR.mkdir(exist_ok=True)

# ============ CONFIG MANAGEMENT ============

def load_or_create_config():
    """Load config from file or create a new one with secure secret key on first start"""
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                config = json.load(f)
                print("Loaded existing config.json")
                return config
        except (FileNotFoundError, json.JSONDecodeError) as e:
            print(f"Warning: Could not load config.json: {e}, creating new one")

    # First start - generate secure secret key
    print("First start detected - generating secure secret key...")
    secret_key = secrets.token_hex(64)  # 128 character hexadecimal string (512 bits)
    master_share_key = secrets.token_hex(32)  # 256-bit AES key for shares

    config = {
        "secret_key": secret_key,
        "master_share_key": master_share_key,
        "created_at": datetime.now().isoformat(),
        "version": "1.0"
    }

    # Save config to file
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=2, ensure_ascii=False)

    print(f"Created new config.json with secure secret key at {CONFIG_PATH}")
    return config

# Load config on startup
APP_CONFIG = load_or_create_config()

# ============ ENCRYPTION ============

# In-memory storage for encryption keys (session_token -> encryption_key)
# This is cleared on server restart, requiring users to re-login
encryption_keys = {}

# In-memory cache for decrypted user data (session_token -> {data, last_heartbeat})
# This avoids re-decrypting on every request
user_data_cache = {}

# Master key for encrypting shared data (class_shares).
# Persisted in config.json so existing shares remain decryptable across restarts.
def _get_or_create_master_share_key():
    if 'master_share_key' in APP_CONFIG:
        return bytes.fromhex(APP_CONFIG['master_share_key'])
    # Migration path: existing config without key — generate, persist, reload.
    print("No master_share_key in config — generating and persisting...")
    APP_CONFIG['master_share_key'] = secrets.token_hex(32)
    with open(CONFIG_PATH, 'w', encoding='utf-8') as _f:
        json.dump(APP_CONFIG, _f, indent=2, ensure_ascii=False)
    return bytes.fromhex(APP_CONFIG['master_share_key'])

MASTER_SHARE_KEY = _get_or_create_master_share_key()

# Heartbeat timeout in seconds - cache is cleared if no heartbeat received
HEARTBEAT_TIMEOUT = 60

def derive_encryption_key(password: str, salt: bytes) -> bytes:
    """Derive a 256-bit encryption key from password using PBKDF2"""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,  # 256 bits for AES-256
        salt=salt,
        iterations=100000,  # Fewer iterations than password hash since this runs on every login
    )
    return kdf.derive(password.encode())

def encrypt_user_data(data: dict, key: bytes) -> str:
    """Encrypt user data using AES-256-GCM"""
    # Convert data to JSON string
    json_data = json.dumps(data, ensure_ascii=False)

    # Generate a random 96-bit nonce (recommended for GCM)
    nonce = os.urandom(12)

    # Encrypt using AES-GCM
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, json_data.encode('utf-8'), None)

    # Combine nonce + ciphertext and encode as base64
    encrypted = base64.b64encode(nonce + ciphertext).decode('ascii')
    return encrypted

def decrypt_user_data(encrypted_data: str, key: bytes) -> dict:
    """Decrypt user data using AES-256-GCM. Returns {} on error (lossy)."""
    try:
        return decrypt_user_data_strict(encrypted_data, key)
    except Exception as e:
        logger.warning("Decryption error (type=%s)", type(e).__name__)
        return {}


def decrypt_user_data_strict(encrypted_data: str, key: bytes) -> dict:
    """Decrypt user data using AES-256-GCM. Raises on any failure.

    Use this in code paths where silent data loss must be impossible (e.g.
    schema migrations that overwrite the original record on success).
    """
    raw = base64.b64decode(encrypted_data)
    nonce = raw[:12]
    ciphertext = raw[12:]
    aesgcm = AESGCM(key)
    plaintext = aesgcm.decrypt(nonce, ciphertext, None)
    return json.loads(plaintext.decode('utf-8'))


def encrypt_share_data(data: dict, key: bytes) -> str:
    """Encrypt share data using AES-256-GCM with master key"""
    # Convert data to JSON string
    json_data = json.dumps(data, ensure_ascii=False)

    # Generate a random 96-bit nonce (recommended for GCM)
    nonce = os.urandom(12)

    # Encrypt using AES-GCM
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, json_data.encode('utf-8'), None)

    # Combine nonce + ciphertext and encode as base64
    encrypted = base64.b64encode(nonce + ciphertext).decode('ascii')
    return encrypted


def decrypt_share_data(encrypted_data: str, key: bytes) -> dict:
    """Decrypt share data using AES-256-GCM with master key"""
    try:
        # Decode from base64
        raw = base64.b64decode(encrypted_data)

        # Extract nonce (first 12 bytes) and ciphertext
        nonce = raw[:12]
        ciphertext = raw[12:]

        # Decrypt
        aesgcm = AESGCM(key)
        plaintext = aesgcm.decrypt(nonce, ciphertext, None)

        # Parse JSON
        return json.loads(plaintext.decode('utf-8'))
    except Exception as e:
        logger.warning("Share data decryption error (type=%s)", type(e).__name__)
        return {}

def hash_password(password: str) -> str:
    """Hash password using PBKDF2 with enhanced security"""
    salt = secrets.token_bytes(32) 
    hashed = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 200000)
    return f"{salt.hex()}:{hashed.hex()}"

def verify_password(stored_password: str, provided_password: str) -> bool:
    """Verify password against stored hash with backward compatibility"""
    try:
        salt_hex, stored_hash = stored_password.split(':')
        salt = bytes.fromhex(salt_hex)
        
        if len(salt) == 32:
            provided_hash = hashlib.pbkdf2_hmac('sha256', provided_password.encode(), salt, 200000)
            return secrets.compare_digest(stored_hash, provided_hash.hex())
        
        else:
            return False
    except:
        return False

def generate_session_token() -> str:
    """Generate a secure session token"""
    return secrets.token_hex(32)

# ============ RECOVERY KEY FUNCTIONS ============

def generate_recovery_key() -> str:
    """Generate a human-readable recovery key: XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"""
    parts = [secrets.token_hex(4).upper() for _ in range(4)]
    return '-'.join(parts)

def hash_recovery_key(recovery_key: str) -> str:
    """Hash a recovery key using PBKDF2 for storage"""
    salt = secrets.token_bytes(32)
    normalized = recovery_key.upper().replace('-', '')
    hashed = hashlib.pbkdf2_hmac('sha256', normalized.encode(), salt, 200000)
    return f"{salt.hex()}:{hashed.hex()}"

def verify_recovery_key(stored_hash: str, recovery_key: str) -> bool:
    """Verify a recovery key against stored hash (constant-time comparison)"""
    try:
        salt_hex, stored = stored_hash.split(':')
        salt = bytes.fromhex(salt_hex)
        normalized = recovery_key.upper().replace('-', '')
        provided = hashlib.pbkdf2_hmac('sha256', normalized.encode(), salt, 200000)
        return secrets.compare_digest(stored, provided.hex())
    except Exception:
        return False

def derive_key_from_recovery(recovery_key: str, salt: bytes) -> bytes:
    """Derive a 256-bit key from a recovery key using PBKDF2"""
    normalized = recovery_key.upper().replace('-', '')
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100000,
    )
    return kdf.derive(normalized.encode())

def encrypt_bytes(data: bytes, key: bytes) -> str:
    """Encrypt raw bytes with AES-256-GCM, return base64 string"""
    nonce = os.urandom(12)
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, data, None)
    return base64.b64encode(nonce + ciphertext).decode('ascii')

def decrypt_bytes(encrypted: str, key: bytes) -> bytes:
    """Decrypt base64 AES-256-GCM ciphertext back to raw bytes"""
    raw = base64.b64decode(encrypted)
    nonce = raw[:12]
    ciphertext = raw[12:]
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(nonce, ciphertext, None)

# NOTE: The server deliberately keeps NO decryptable copy of the recovery key.
# Earlier versions stored one (wrapped with a server-side master key), which
# meant anyone with DB + config.json access could decrypt every user's data —
# breaking the zero-knowledge promise — and let an attacker who controlled a
# user's mailbox request the plaintext key and take over the account.
# Only the PBKDF2 hash (for verification) and the recovery-key-wrapped DEK
# (for password reset) are stored; neither is reversible by the server.

# ============ EMAIL / SMTP FUNCTIONS ============

def smtp_is_configured() -> bool:
    """Return True if SMTP settings are present in config"""
    cfg = APP_CONFIG
    return bool(cfg.get('smtp_host') and cfg.get('smtp_user') and cfg.get('smtp_from'))

def _send_email_sync(to_addr: str, subject: str, html_body: str, text_body: str, pdf_attachment: bytes = None, pdf_filename: str = None):
    """Send an email synchronously (run in executor to avoid blocking)"""
    cfg = APP_CONFIG
    
    # Create message with mixed content for attachment
    msg = MIMEMultipart('mixed')
    msg['Subject'] = subject
    msg['From'] = cfg.get('smtp_from', cfg.get('smtp_user', ''))
    msg['To'] = to_addr
    
    # Create alternative part for text/html
    msg_alternative = MIMEMultipart('alternative')
    msg.attach(msg_alternative)
    msg_alternative.attach(MIMEText(text_body, 'plain', 'utf-8'))
    msg_alternative.attach(MIMEText(html_body, 'html', 'utf-8'))

    # Attach PDF if provided
    print(f"[EMAIL] PDF attachment provided: {pdf_attachment is not None}, filename: {pdf_filename}")
    if pdf_attachment and pdf_filename:
        print(f"[EMAIL] Attaching PDF: {len(pdf_attachment)} bytes")
        from email.mime.application import MIMEApplication
        part = MIMEApplication(pdf_attachment, Name=pdf_filename)
        part['Content-Disposition'] = f'attachment; filename="{pdf_filename}"'
        msg.attach(part)
        print(f"[EMAIL] PDF attached successfully. Message parts: {len(msg.get_payload())}")
    else:
        print(f"[EMAIL] No PDF attachment. pdf_attachment={pdf_attachment is not None}, pdf_filename={pdf_filename}")

    host = cfg.get('smtp_host', '')
    port = int(cfg.get('smtp_port', 587))
    user = cfg.get('smtp_user', '')
    password = cfg.get('smtp_password', '')
    use_tls = cfg.get('smtp_use_tls', True)

    if use_tls:
        server = smtplib.SMTP(host, port, timeout=10)
        server.ehlo()
        server.starttls()
    else:
        server = smtplib.SMTP_SSL(host, port, timeout=10)
    server.login(user, password)
    server.sendmail(msg['From'], [to_addr], msg.as_string())
    server.quit()
    print(f"[EMAIL] Email sent successfully to {to_addr}")

async def send_password_reset_email(to_addr: str, username: str, reset_token: str):
    """Send a password reset email (fires in background thread)"""
    app_url = APP_CONFIG.get('app_url', 'http://localhost:5000').rstrip('/')
    reset_url = f"{app_url}/login?token={reset_token}"

    subject = "EduGrade – Passwort zurücksetzen / Reset your password"

    html_body = f"""
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem;">
        <h2 style="margin-bottom: 0.5rem;">EduGrade – Passwort zurücksetzen</h2>
        <p>Hallo {username},</p>
        <p>du hast einen Passwort-Reset angefordert. <strong>Achtung: Da kein Recovery Key vorhanden ist, werden dabei alle deine Daten (Klassen, Schüler, Noten) unwiderruflich gelöscht.</strong></p>
        <p>
            <a href="{reset_url}" style="display:inline-block;padding:0.75rem 1.5rem;background:#9333ea;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold;">Passwort jetzt zurücksetzen</a>
        </p>
        <p style="color:#888;font-size:0.875rem;">Dieser Link ist 1 Stunde gültig. Falls du keinen Reset angefordert hast, ignoriere diese E-Mail.</p>
        <hr style="border:none;border-top:1px solid #333;margin:1.5rem 0;">
        <p style="color:#888;font-size:0.75rem;">EduGrade &mdash; <a href="{app_url}">{app_url}</a></p>
    </div>
    """

    text_body = (
        f"EduGrade – Passwort zurücksetzen\n\n"
        f"Hallo {username},\n\n"
        f"du hast einen Passwort-Reset angefordert.\n"
        f"ACHTUNG: Alle deine Daten werden dabei unwiderruflich gelöscht (kein Recovery Key vorhanden).\n\n"
        f"Link: {reset_url}\n\n"
        f"Dieser Link ist 1 Stunde gültig.\n"
        f"Falls du keinen Reset angefordert hast, ignoriere diese E-Mail."
    )

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _send_email_sync, to_addr, subject, html_body, text_body)


async def send_org_join_request_email(to_addr: str, admin_username: str, org_name: str, requester_username: str, requester_email: str):
    """Notify an org admin that a teacher requested to join (best-effort, non-blocking)."""
    app_url = APP_CONFIG.get('app_url', 'http://localhost:5000').rstrip('/')
    subject = f"EduGrade – Neue Beitrittsanfrage für {org_name}"
    html_body = f"""
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem;">
        <h2 style="margin-bottom: 0.5rem;">Neue Beitrittsanfrage</h2>
        <p>Hallo {admin_username},</p>
        <p><strong>{requester_username}</strong> ({requester_email}) möchte deiner Organisation <strong>{org_name}</strong> beitreten.</p>
        <p>Bitte in den Organisation-Einstellungen bestätigen oder ablehnen.</p>
        <hr style="border:none;border-top:1px solid #333;margin:1.5rem 0;">
        <p style="color:#888;font-size:0.75rem;">EduGrade &mdash; <a href="{app_url}">{app_url}</a></p>
    </div>
    """
    text_body = (
        f"Neue Beitrittsanfrage\n\n"
        f"Hallo {admin_username},\n\n"
        f"{requester_username} ({requester_email}) möchte deiner Organisation {org_name} beitreten.\n"
        f"Bitte in den Organisation-Einstellungen bestätigen oder ablehnen."
    )
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _send_email_sync, to_addr, subject, html_body, text_body)


async def send_org_approved_email(to_addr: str, username: str, org_name: str):
    """Notify a teacher that their org join request was approved."""
    app_url = APP_CONFIG.get('app_url', 'http://localhost:5000').rstrip('/')
    subject = f"EduGrade – Beitritt zu {org_name} bestätigt"
    html_body = f"""
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem;">
        <h2 style="margin-bottom: 0.5rem;">Beitritt bestätigt</h2>
        <p>Hallo {username},</p>
        <p>dein Beitritt zur Organisation <strong>{org_name}</strong> wurde bestätigt.</p>
        <hr style="border:none;border-top:1px solid #333;margin:1.5rem 0;">
        <p style="color:#888;font-size:0.75rem;">EduGrade &mdash; <a href="{app_url}">{app_url}</a></p>
    </div>
    """
    text_body = (
        f"Beitritt bestätigt\n\n"
        f"Hallo {username},\n\n"
        f"dein Beitritt zur Organisation {org_name} wurde bestätigt."
    )
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _send_email_sync, to_addr, subject, html_body, text_body)


async def send_org_handover_email(to_addr: str, username: str, from_username: str, class_name: str):
    """Notify a teacher that a class was offered to them via handover."""
    app_url = APP_CONFIG.get('app_url', 'http://localhost:5000').rstrip('/')
    subject = f"EduGrade – Klassenübergabe: {class_name}"
    html_body = f"""
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem;">
        <h2 style="margin-bottom: 0.5rem;">Klasse angeboten</h2>
        <p>Hallo {username},</p>
        <p><strong>{from_username}</strong> möchte dir die Klasse <strong>{class_name}</strong> übergeben.</p>
        <p>Bitte in den Organisation-Einstellungen annehmen oder ablehnen.</p>
        <hr style="border:none;border-top:1px solid #333;margin:1.5rem 0;">
        <p style="color:#888;font-size:0.75rem;">EduGrade &mdash; <a href="{app_url}">{app_url}</a></p>
    </div>
    """
    text_body = (
        f"Klasse angeboten\n\n"
        f"Hallo {username},\n\n"
        f"{from_username} möchte dir die Klasse {class_name} übergeben.\n"
        f"Bitte in den Organisation-Einstellungen annehmen oder ablehnen."
    )
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _send_email_sync, to_addr, subject, html_body, text_body)


def generate_recovery_key_pdf(username: str, recovery_key: str, language: str = 'de') -> bytes:
    """Generate a modern PDF document with the recovery key"""
    if not REPORTLAB_AVAILABLE:
        raise RuntimeError("reportlab library not available")

    is_en = language == 'en'

    # ── Localised strings ──────────────────────────────────────────────────
    txt = {
        'account':     'Account' if is_en else 'Konto',
        'footer_app':  'EduGrade – Secure Grade Management' if is_en else 'EduGrade – Sicheres Notenmanagement',
        'footer_date': 'Generated on' if is_en else 'Erstellt am',
        'footer_time': '' if is_en else ' um',
        'footer_time_suffix': '' if is_en else ' Uhr',
        'sec_label':   'YOUR RECOVERY KEY' if is_en else 'DEIN RECOVERY KEY',
        'sec_intro':   (
            'This key is the only way to restore your account and all your data '
            'if you forget your password.'
        ) if is_en else (
            'Dieser Key ist der einzige Weg, deinen Account und alle deine Daten '
            'wiederherzustellen, falls du dein Passwort vergisst.'
        ),
        'warn_label':  'SECURITY NOTICE' if is_en else 'SICHERHEITSHINWEIS',
        'warn_text': (
            '<b>⚠ Store this document in a safe place.</b><br/>'
            'Due to strong end-to-end encryption, your account can <b>only</b> be restored '
            'with this recovery key. The avocloud.net team has no access to your data and '
            'cannot help without this key.'
        ) if is_en else (
            '<b>⚠ Bewahre dieses Dokument sicher auf.</b><br/>'
            'Aufgrund der starken Ende-zu-Ende-Verschlüsselung kann dein Account '
            '<b>ausschließlich</b> mit diesem Recovery Key wiederhergestellt werden. '
            'Das avocloud.net Team hat keinen Zugriff auf deine Daten und kann '
            'ohne diesen Key nicht helfen.'
        ),
        'how_label':   'HOW TO USE THIS KEY' if is_en else 'SO VERWENDEST DU DEN KEY',
        'steps': [
            ('1.&nbsp;&nbsp;Keep this document in a safe place (e.g. with important papers or in a password manager).' if is_en else
             '1.&nbsp;&nbsp;Bewahre dieses Dokument an einem sicheren Ort auf (z.&nbsp;B. bei wichtigen Unterlagen oder in einem Passwort-Manager).'),
            ('2.&nbsp;&nbsp;Open the EduGrade login page and click <b>"Forgot password?"</b>.' if is_en else
             '2.&nbsp;&nbsp;Öffne die EduGrade-Anmeldeseite und klicke auf <b>„Passwort vergessen?"</b>.'),
            ('3.&nbsp;&nbsp;Enter your email address and this recovery key.' if is_en else
             '3.&nbsp;&nbsp;Gib deine E-Mail-Adresse und diesen Recovery Key ein.'),
            ('4.&nbsp;&nbsp;Choose a new password — all your data will be fully preserved.' if is_en else
             '4.&nbsp;&nbsp;Wähle ein neues Passwort — alle deine Daten bleiben vollständig erhalten.'),
        ],
        'hint': (
            'This document was automatically generated by EduGrade and contains confidential access data. '
            'Do not share it with others.'
        ) if is_en else (
            'Dieses Dokument wurde automatisch von EduGrade generiert und enthält vertrauliche Zugangsdaten. '
            'Teile es nicht mit anderen Personen.'
        ),
    }

    now = datetime.now()
    if is_en:
        date_str = now.strftime("%Y-%m-%d %H:%M")
        footer_date = f"Generated on {date_str}"
    else:
        date_str = now.strftime("%d.%m.%Y")
        time_str = now.strftime("%H:%M")
        footer_date = f"Erstellt am {date_str} um {time_str} Uhr"

    PURPLE_DARK  = colors.HexColor('#1e1b4b')
    PURPLE_LIGHT = colors.HexColor('#7c3aed')
    PURPLE_BG    = colors.HexColor('#f5f3ff')
    PURPLE_BORDER= colors.HexColor('#a78bfa')
    AMBER_BG     = colors.HexColor('#fffbeb')
    AMBER_BORDER = colors.HexColor('#fbbf24')
    GRAY_TEXT    = colors.HexColor('#374151')
    GRAY_LIGHT   = colors.HexColor('#9ca3af')
    GRAY_RULE    = colors.HexColor('#e5e7eb')
    WHITE        = colors.white

    PAGE_W, PAGE_H = A4
    HEADER_H = 4.8 * cm
    MARGIN   = 2.5 * cm

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        rightMargin=MARGIN, leftMargin=MARGIN,
        topMargin=HEADER_H + 1.2*cm, bottomMargin=2.8*cm
    )

    # ── Canvas callbacks for header & footer ───────────────────────────────
    def _draw_page(canvas, doc):
        canvas.saveState()

        # Header background
        canvas.setFillColor(PURPLE_DARK)
        canvas.rect(0, PAGE_H - HEADER_H, PAGE_W, HEADER_H, fill=1, stroke=0)

        # Accent strip at bottom of header
        canvas.setFillColor(PURPLE_LIGHT)
        canvas.rect(0, PAGE_H - HEADER_H, PAGE_W, 0.25*cm, fill=1, stroke=0)

        # App name
        canvas.setFillColor(WHITE)
        canvas.setFont('Helvetica-Bold', 28)
        canvas.drawCentredString(PAGE_W / 2, PAGE_H - 2.1*cm, 'EduGrade')

        # "Recovery Kit" badge-style subtitle
        canvas.setFont('Helvetica', 12)
        canvas.setFillColor(colors.HexColor('#c4b5fd'))
        canvas.drawCentredString(PAGE_W / 2, PAGE_H - 2.9*cm, 'Recovery Kit')

        # Username line
        canvas.setFont('Helvetica', 9)
        canvas.setFillColor(colors.HexColor('#a5b4fc'))
        canvas.drawCentredString(PAGE_W / 2, PAGE_H - 3.75*cm, f'{txt["account"]}: {username}')

        # Footer separator
        canvas.setStrokeColor(GRAY_RULE)
        canvas.setLineWidth(0.4)
        canvas.line(MARGIN, 2.2*cm, PAGE_W - MARGIN, 2.2*cm)

        # Footer text
        canvas.setFont('Helvetica', 7.5)
        canvas.setFillColor(GRAY_LIGHT)
        canvas.drawString(MARGIN, 1.7*cm, txt['footer_app'])
        canvas.drawRightString(PAGE_W - MARGIN, 1.7*cm, footer_date)

        canvas.restoreState()

    # ── Paragraph styles ───────────────────────────────────────────────────
    styles = getSampleStyleSheet()

    def _style(name, **kw):
        return ParagraphStyle(name, parent=styles['Normal'], **kw)

    label_style = _style('Label',
        fontSize=7.5, fontName='Helvetica-Bold',
        textColor=PURPLE_LIGHT, spaceBefore=20, spaceAfter=5,
        leading=10
    )
    body_style = _style('Body',
        fontSize=10.5, textColor=GRAY_TEXT, leading=17, spaceAfter=4
    )
    key_style = _style('Key',
        fontSize=19, fontName='Courier-Bold',
        textColor=PURPLE_DARK, alignment=TA_CENTER,
        spaceBefore=10, spaceAfter=10
    )
    warning_style = _style('Warn',
        fontSize=10, textColor=colors.HexColor('#92400e'), leading=16
    )
    step_style = _style('Step',
        fontSize=10, textColor=GRAY_TEXT, leading=18, leftIndent=8
    )
    hint_style = _style('Hint',
        fontSize=8.5, textColor=GRAY_LIGHT, leading=13, spaceBefore=16
    )

    def _box(content_rows, bg, border, pad=12):
        t = Table(content_rows, colWidths=[doc.width])
        t.setStyle(TableStyle([
            ('BACKGROUND',    (0, 0), (-1, -1), bg),
            ('BOX',           (0, 0), (-1, -1), 1.5, border),
            ('TOPPADDING',    (0, 0), (-1, -1), pad),
            ('BOTTOMPADDING', (0, 0), (-1, -1), pad),
            ('LEFTPADDING',   (0, 0), (-1, -1), pad + 2),
            ('RIGHTPADDING',  (0, 0), (-1, -1), pad + 2),
        ]))
        return t

    # ── Story ──────────────────────────────────────────────────────────────
    story = []

    # Section: Recovery Key
    story.append(Paragraph(txt['sec_label'], label_style))
    story.append(Paragraph(txt['sec_intro'], body_style))
    story.append(Spacer(1, 0.3*cm))

    story.append(_box([[Paragraph(recovery_key, key_style)]], PURPLE_BG, PURPLE_BORDER, pad=18))
    story.append(Spacer(1, 0.5*cm))

    # Section: Security warning
    story.append(HRFlowable(width='100%', thickness=0.4, color=GRAY_RULE, spaceAfter=0))
    story.append(Spacer(1, 0.35*cm))
    story.append(Paragraph(txt['warn_label'], label_style))
    story.append(_box([[Paragraph(txt['warn_text'], warning_style)]], AMBER_BG, AMBER_BORDER))
    story.append(Spacer(1, 0.5*cm))

    # Section: How to use
    story.append(HRFlowable(width='100%', thickness=0.4, color=GRAY_RULE, spaceAfter=0))
    story.append(Spacer(1, 0.35*cm))
    story.append(Paragraph(txt['how_label'], label_style))
    for step in txt['steps']:
        story.append(Paragraph(step, step_style))

    story.append(Spacer(1, 0.5*cm))
    story.append(HRFlowable(width='100%', thickness=0.4, color=GRAY_RULE, spaceAfter=0))
    story.append(Paragraph(
        txt['hint'],
        hint_style
    ))

    try:
        doc.build(story, onFirstPage=_draw_page, onLaterPages=_draw_page)
        pdf_bytes = buffer.getvalue()
        buffer.close()
        print(f"PDF generated successfully: {len(pdf_bytes)} bytes")
        return pdf_bytes
    except Exception as e:
        buffer.close()
        print(f"PDF generation failed: {e}")
        import traceback
        traceback.print_exc()
        raise

async def send_recovery_key_email(to_addr: str, username: str, recovery_key: str, language: str = 'de'):
    """Send the recovery key as a PDF attachment via email"""
    app_url = APP_CONFIG.get('app_url', 'http://localhost:5000').rstrip('/')

    # Language-specific content
    if language == 'en':
        subject = "EduGrade – Your Recovery Kit"
        html_body = f"""
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem;">
            <h2 style="margin-bottom: 0.5rem;">EduGrade Recovery Kit</h2>
            <p>Hello {username},</p>
            <p>You have requested your recovery key. Attached you will find your <strong>"EduGrade Recovery Kit"</strong> as a PDF.</p>
            <p><strong>Important:</strong></p>
            <ul>
                <li>Keep this document in a safe place</li>
                <li>Without this recovery key, your data (classes, students, grades) cannot be recovered if you forget your password</li>
                <li>You can use the recovery key at login under "Forgot Password?"</li>
            </ul>
            <p style="color:#888;font-size:0.875rem;">If you did not make this request, please change your password immediately.</p>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:1.5rem 0;">
            <p style="color:#888;font-size:0.75rem;">avocloud.net Team &mdash; <a href="{app_url}">{app_url}</a></p>
        </div>
        """
        text_body = (
            f"EduGrade Recovery Kit\n\n"
            f"Hello {username},\n\n"
            f"You have requested your recovery key. Attached you will find your Recovery Kit as a PDF.\n\n"
            f"IMPORTANT:\n"
            f"- Keep this document in a safe place\n"
            f"- Without this recovery key, your data cannot be recovered if you forget your password\n\n"
            f"If you did not make this request, please change your password immediately.\n\n"
            f"avocloud.net Team"
        )
    else:  # German (default)
        subject = "EduGrade – Dein Recovery Kit"
        html_body = f"""
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem;">
            <h2 style="margin-bottom: 0.5rem;">EduGrade Recovery Kit</h2>
            <p>Hallo {username},</p>
            <p>du hast deinen Recovery Key angefordert. Im Anhang findest du dein <strong>„EduGrade Recovery Kit"</strong> als PDF.</p>
            <p><strong>Wichtig:</strong></p>
            <ul>
                <li>Bewahre dieses Dokument an einem sicheren Ort auf</li>
                <li>Ohne diesen Recovery Key können deine Daten (Klassen, Schüler, Noten) bei Passwortverlust nicht wiederhergestellt werden</li>
                <li>Du kannst den Recovery Key beim Login unter „Passwort vergessen?" verwenden</li>
            </ul>
            <p style="color:#888;font-size:0.875rem;">Falls du diese Anfrage nicht gestellt hast, ändere bitte umgehend dein Passwort.</p>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:1.5rem 0;">
            <p style="color:#888;font-size:0.75rem;">avocloud.net Team &mdash; <a href="{app_url}">{app_url}</a></p>
        </div>
        """
        text_body = (
            f"EduGrade Recovery Kit\n\n"
            f"Hallo {username},\n\n"
            f"du hast deinen Recovery Key angefordert. Im Anhang findest du dein Recovery Kit als PDF.\n\n"
            f"WICHTIG:\n"
            f"- Bewahre dieses Dokument an einem sicheren Ort auf\n"
            f"- Ohne diesen Recovery Key können deine Daten bei Passwortverlust nicht wiederhergestellt werden\n\n"
            f"Falls du diese Anfrage nicht gestellt hast, ändere bitte umgehend dein Passwort.\n\n"
            f"avocloud.net Team"
        )

    # Generate PDF
    print(f"[RECOVERY EMAIL] Starting PDF generation for {to_addr}...")
    pdf_bytes = None
    pdf_error = None
    try:
        pdf_bytes = generate_recovery_key_pdf(username, recovery_key, language)
        print(f"[RECOVERY EMAIL] PDF generated: {len(pdf_bytes)} bytes")
    except Exception as e:
        pdf_error = str(e)
        print(f"[RECOVERY EMAIL] PDF generation error: {e}")

    print(f"[RECOVERY EMAIL] Sending email to {to_addr} with PDF={pdf_bytes is not None}...")
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(
        None,
        _send_email_sync,
        to_addr,
        subject,
        html_body,
        text_body,
        pdf_bytes,
        "EduGrade_Recovery_Kit.pdf" if pdf_bytes else None
    )

    if pdf_error:
        print(f"[RECOVERY EMAIL] Sent without PDF attachment due to: {pdf_error}")
    elif pdf_bytes:
        print(f"[RECOVERY EMAIL] Sent with PDF attachment ({len(pdf_bytes)} bytes)")
    else:
        print("[RECOVERY EMAIL] Sent without PDF attachment (reportlab not available)")

# ============ STUDENT ACCESS FUNCTIONS ============

def hash_pin(pin: str) -> str:
    """Hash a PIN using PBKDF2 with 50k iterations and 16-byte salt"""
    salt = secrets.token_bytes(16)
    hashed = hashlib.pbkdf2_hmac('sha256', pin.encode(), salt, 50000)
    return f"{salt.hex()}:{hashed.hex()}"

def verify_pin(stored_hash: str, pin: str) -> bool:
    """Verify a PIN against stored hash (constant-time comparison)"""
    try:
        salt_hex, stored = stored_hash.split(':')
        salt = bytes.fromhex(salt_hex)
        provided = hashlib.pbkdf2_hmac('sha256', pin.encode(), salt, 50000)
        return secrets.compare_digest(stored, provided.hex())
    except Exception:
        return False

def generate_unique_pin(existing_pins: set) -> str:
    """Generate a unique 6-digit PIN"""
    for _ in range(1000):
        pin = f"{secrets.randbelow(1000000):06d}"
        if pin not in existing_pins:
            return pin
    raise ValueError("Could not generate unique PIN")

def generate_share_token() -> str:
    """Generate a cryptographically secure share token"""
    return secrets.token_urlsafe(16)

def get_student_display_name(student: dict) -> str:
    """Build display name from firstName/lastName/middleName fields, with fallback to legacy name field"""
    first = student.get('firstName', '')
    middle = student.get('middleName', '')
    last = student.get('lastName', '')
    if first or last:
        parts = [p for p in [first, middle, last] if p]
        return ' '.join(parts)
    return student.get('name', '')

def _percent_to_grade(percentage: float) -> int:
    """Map a percentage to a grade (mirrors studentView.js fallback thresholds)."""
    if percentage >= 85:
        return 1
    if percentage >= 70:
        return 2
    if percentage >= 55:
        return 3
    if percentage >= 40:
        return 4
    return 5


def compute_weighted_average(grades: list, pm_settings: dict | None) -> float:
    """Python port of studentView.js calculateWeightedAverage.

    Per category: average numeric grades; convert +/~/- counts to a percentage
    (plus=100, neutral=50, minus=0 by default) and fold the resulting grade in
    as one extra grade. Category averages are then weighted by category weight.
    Returns 0.0 when there is nothing to average.
    """
    pm_settings = pm_settings or {}
    pct_plus = pm_settings.get('plus', 100)
    pct_neutral = pm_settings.get('neutral', 50)
    pct_minus = pm_settings.get('minus', 0)

    by_category: dict = {}
    for g in grades:
        if not isinstance(g, dict):
            continue
        cat = by_category.setdefault(g.get('categoryId'), {
            'weight': g.get('weight') or 0,
            'numeric': [], 'plus': 0, 'neutral': 0, 'minus': 0
        })
        if g.get('isPlusMinus'):
            v = g.get('value')
            if v == '+':
                cat['plus'] += 1
            elif v == '~':
                cat['neutral'] += 1
            elif v == '-':
                cat['minus'] += 1
        else:
            v = g.get('value')
            if v is not None:
                try:
                    cat['numeric'].append(float(v))
                except (TypeError, ValueError):
                    pass

    weighted_sum = 0.0
    total_weight = 0.0
    for cat in by_category.values():
        avg = None
        if cat['numeric']:
            avg = sum(cat['numeric']) / len(cat['numeric'])
        pm_total = cat['plus'] + cat['neutral'] + cat['minus']
        if pm_total > 0:
            points = cat['plus'] * pct_plus + cat['neutral'] * pct_neutral + cat['minus'] * pct_minus
            pm_grade = _percent_to_grade(points / pm_total)
            if avg is None:
                avg = float(pm_grade)
            else:
                avg = (avg * len(cat['numeric']) + pm_grade) / (len(cat['numeric']) + 1)
        if avg is not None:
            weighted_sum += avg * cat['weight']
            total_weight += cat['weight']

    if total_weight == 0:
        return 0.0
    return max(1.0, min(5.0, weighted_sum / total_weight))


def final_grade_label(average: float) -> str:
    """Python port of studentView.js calculateFinalGrade."""
    if not average:
        return '-'
    if average <= 1.5:
        return '1'
    if average <= 2.5:
        return '2'
    if average <= 3.5:
        return '3'
    if average <= 4.5:
        return '4'
    return '5'


def build_share_snapshot(user_data: dict, class_id: str) -> dict | None:
    """Extract class + students + grades + categories for a share snapshot"""
    cls = None
    for c in user_data.get('classes', []):
        if c.get('id') == class_id:
            cls = c
            break
    if not cls:
        return None

    # Get the current year from the class to access students
    current_year_id = cls.get('currentYearId')
    current_year = None
    if current_year_id and cls.get('years'):
        for year in cls.get('years', []):
            if year.get('id') == current_year_id:
                current_year = year
                break
    
    # Get students from the current year if available, otherwise from class (fallback for backward compatibility)
    students = current_year.get('students', []) if current_year else cls.get('students', [])

    return {
        'students': students,
        'categories': user_data.get('categories', []),
        'subjects': current_year.get('subjects', []) if current_year else cls.get('subjects', []),
        'plusMinusGradeSettings': user_data.get('plusMinusGradeSettings', {
            'startGrade': 3, 'plusValue': 0.5, 'minusValue': 0.5
        })
    }

def user_has_active_share(user_id: str, class_id=None) -> bool:
    """Cheap check: does this user have any active class share (optionally for a specific class)?"""
    for _, share in db_layer.iter_shares():
        if share.get('user_id') != user_id or not share.get('active', False):
            continue
        if class_id is not None and str(share.get('class_id')) != str(class_id):
            continue
        return True
    return False


def update_active_shares_for_user(user_id: str, user_data: dict):
    """Update all active share snapshots for a user"""
    for token, share in db_layer.iter_shares():
        if share.get('user_id') != user_id or not share.get('active', False):
            continue
        expires_at = share.get('expires_at')
        if expires_at and datetime.fromisoformat(expires_at) < datetime.now():
            share['active'] = False
            db_layer.put_share(token, share)
            continue
        snapshot = build_share_snapshot(user_data, share['class_id'])
        if snapshot:
            encrypted_snapshot = encrypt_share_data(snapshot, MASTER_SHARE_KEY)
            share['encrypted_data'] = encrypted_snapshot
            for c in user_data.get('classes', []):
                if c.get('id') == share['class_id']:
                    share['class_name'] = c.get('name', share.get('class_name', ''))
                    break
            db_layer.put_share(token, share)

# ============ ORGANISATION HELPERS ============

def _get_current_year(cls: dict) -> dict | None:
    """Return the current-year sub-object of a class, or None."""
    current_year_id = cls.get('currentYearId')
    if current_year_id and cls.get('years'):
        for year in cls.get('years', []):
            if year.get('id') == current_year_id:
                return year
    return None


def _current_students(cls: dict) -> list[dict]:
    """Students of a class's current year (fallback to legacy top-level field)."""
    current_year = _get_current_year(cls)
    return current_year.get('students', []) if current_year else cls.get('students', [])


def generate_org_join_code() -> str:
    """Generate an 8-char hex join code (32 bits — brute-force resistance comes
    from rate limiting + the admin-approval gate, not code length alone)."""
    return secrets.token_hex(4).upper()


def sync_org_roster_for_class(user_id: str, class_id, cls: dict, teacher_name: str):
    """Refresh org_roster rows for one class if the owner is an approved org member."""
    membership = db_layer.get_org_membership(user_id)
    if not membership or membership.get('status') != 'approved':
        return
    names = [get_student_display_name(s) for s in _current_students(cls) if isinstance(s, dict)]
    db_layer.replace_roster_for_class(
        membership['org_id'], user_id, class_id, cls.get('name', ''), teacher_name,
        names, datetime.now().isoformat()
    )


def sync_org_roster_for_user(user_id: str, data: dict):
    """Refresh org_roster rows for all of a user's classes (full-sync path)."""
    membership = db_layer.get_org_membership(user_id)
    if not membership or membership.get('status') != 'approved':
        return
    db_layer.delete_roster_for_user(membership['org_id'], user_id)
    teacher_name = data.get('teacherName', '')
    for cls in data.get('classes', []):
        cid = cls.get('id')
        if cid is None:
            continue
        sync_org_roster_for_class(user_id, cid, cls, teacher_name)


def build_handover_snapshot(cls: dict, categories: list, include: dict) -> dict:
    """Build a filtered copy of a class for a handover, honoring `include` flags.

    Mirrors build_share_snapshot's server-side filtering pattern: fields the
    sender unchecked are stripped here, not left to the client to hide.
    """
    cls_copy = json.loads(json.dumps(cls))  # deep copy
    current_year = _get_current_year(cls_copy)
    students = current_year.get('students', []) if current_year else cls_copy.get('students', [])

    if not include.get('students', True):
        students = []
    else:
        for s in students:
            if not isinstance(s, dict):
                continue
            if not include.get('grades', True):
                s['grades'] = []
            if not include.get('entries', True):
                s['participation'] = []
            if not include.get('comments', True):
                s['notes'] = ''

    if current_year is not None:
        current_year['students'] = students
    else:
        cls_copy['students'] = students

    return {
        'class': cls_copy,
        'categories': categories if include.get('categories', True) else [],
    }


def init_db():
    """Initialize SQLite schema via db.py."""
    db_layer.init_schema()


def migrate_plaintext_shares():
    """Migrate any existing plaintext shares to encrypted format"""
    for token, share in db_layer.iter_shares():
        if 'data' in share and 'encrypted_data' not in share:
            snapshot = share['data']
            encrypted_snapshot = encrypt_share_data(snapshot, MASTER_SHARE_KEY)
            del share['data']
            share['encrypted_data'] = encrypted_snapshot
            db_layer.put_share(token, share)
            print(f"Migrated share {token[:8]} to encrypted format")


def purge_stored_recovery_key_copies():
    """One-time hygiene: delete legacy server-decryptable recovery key copies.

    Older versions stored each user's recovery key encrypted with a key the
    server itself could derive (master key + email), which broke the
    zero-knowledge model. The field is no longer written anywhere; this sweep
    removes existing copies. Password reset via recovery key keeps working —
    it only needs recovery_key_hash + encrypted_dek, which stay untouched.
    """
    removed = 0
    for email, user in db_layer.iter_users():
        if 'encrypted_recovery_key' in user:
            user.pop('encrypted_recovery_key', None)
            db_layer.put_user(email, user)
            removed += 1
    if removed:
        logger.info("Purged server-decryptable recovery key copies for %d user(s)", removed)


async def cleanup_expired_sessions():
    """Remove expired sessions and their caches"""
    now = datetime.now()
    now_iso = now.isoformat()

    expired_tokens = db_layer.delete_expired_sessions(now_iso)
    for token in expired_tokens:
        clear_session_cache(token)

    # Also clean up stale caches (no heartbeat for too long)
    stale_tokens = []
    for token, cache_entry in user_data_cache.items():
        if (now - cache_entry["last_heartbeat"]).total_seconds() > HEARTBEAT_TIMEOUT * 2:
            stale_tokens.append(token)

    for token in stale_tokens:
        print(f"Clearing stale cache for token {token[:8]}...")
        clear_session_cache(token)

    # Clean up expired/inactive shares
    shares_to_delete = []
    for token, share in db_layer.iter_shares():
        if not share.get('active', True):
            shares_to_delete.append(token)
        else:
            expires_at = share.get('expires_at')
            if expires_at:
                exp = datetime.fromisoformat(expires_at)
                if exp < now:
                    share['active'] = False
                    db_layer.put_share(token, share)
                    if exp + timedelta(days=1) < now:
                        shares_to_delete.append(token)
                elif exp + timedelta(days=30) < now:
                    shares_to_delete.append(token)
    for token in shares_to_delete:
        db_layer.delete_share(token)

    # Clean up expired password reset tokens
    db_layer.delete_expired_reset_tokens(now_iso)

    # Clean up expired (unaccepted) class handovers
    db_layer.delete_expired_handovers(now_iso)

    return None

# ============ V2 SCHEMA HELPERS ============
# v2 layout stored in SQLite (db.py):
#   user_meta row  — version=2, meta_ct = ciphertext of meta dict
#                    (everything except 'classes', plus 'classOrder')
#   user_classes rows — one row per class_id: ct = ciphertext
# Logical equivalent of the old in-memory dict shape:
# {
#   "version": 2,
#   "encrypted": True,
#   "meta":    <meta_ct>,
#   "classes": { "<class_id>": <ciphertext>, ... } # one ciphertext per class (students/grades/etc.)
# }

def _split_blob_for_v2(data: dict):
    """Split a full user-data blob into (meta_dict, classes_dict).
    classes_dict maps class_id (str) -> class object.
    meta_dict carries 'classOrder' (list of class_ids) so order is preserved.
    """
    data = data or {}
    classes_list = data.get('classes', []) or []
    classes_dict = {}
    class_order = []
    for c in classes_list:
        if not isinstance(c, dict):
            continue
        cid = c.get('id')
        if cid is None:
            continue
        classes_dict[str(cid)] = c
        class_order.append(str(cid))
    meta = {k: v for k, v in data.items() if k != 'classes'}
    meta['classOrder'] = class_order
    return meta, classes_dict


def _assemble_blob_from_v2(meta: dict, classes_dict: dict) -> dict:
    """Reassemble a full blob from v2 meta + per-class dicts."""
    meta = dict(meta or {})
    classes_dict = classes_dict or {}
    order = meta.pop('classOrder', None) or []
    classes_list = []
    seen = set()
    for cid in order:
        c = classes_dict.get(str(cid))
        if c is not None:
            classes_list.append(c)
            seen.add(str(cid))
    for cid, c in classes_dict.items():
        if str(cid) not in seen:
            classes_list.append(c)
    meta['classes'] = classes_list
    return meta



def migrate_user_to_v2(user_id: str, encryption_key: bytes) -> bool:
    """One-shot migration of a legacy single-blob record to v2 split format.
    Returns True if a migration was actually performed.

    SAFETY: never overwrites the original record unless decryption succeeded.
    A failed decrypt raises and leaves the v1 blob intact, so a wrong key or
    corrupted ciphertext can never silently wipe a user's data.
    """
    if not encryption_key:
        return False
    meta_rec = db_layer.get_meta_record(user_id)
    if meta_rec is None:
        return False
    if meta_rec.get('version') == 2:
        return False

    legacy_ct = meta_rec.get('legacy_ct')
    is_encrypted = meta_rec.get('encrypted', True)
    if legacy_ct:
        if is_encrypted:
            try:
                full = decrypt_user_data_strict(legacy_ct, encryption_key)
            except Exception as e:
                logger.error(
                    "Refusing v2 migration for user %s: decrypt failed (%s). "
                    "Original v1 record kept intact.",
                    user_id, type(e).__name__
                )
                raise
            if not isinstance(full, dict):
                raise ValueError("Decrypted v1 payload is not a JSON object")
        else:
            # Plaintext legacy record: encryption_key is now available (called
            # post-login), so we parse the JSON and encrypt into v2 directly.
            if not encryption_key:
                logger.warning(
                    "Skipping v2 migration for plaintext user %s: no key available", user_id
                )
                return False
            try:
                full = json.loads(legacy_ct)
            except Exception as e:
                logger.error(
                    "Refusing v2 migration for plaintext user %s: JSON parse failed (%s).",
                    user_id, type(e).__name__
                )
                raise
            if not isinstance(full, dict):
                raise ValueError("Plaintext v1 payload is not a JSON object")
    else:
        full = {}

    meta, classes_dict = _split_blob_for_v2(full)
    db_layer.put_meta_ct(user_id, encrypt_user_data(meta, encryption_key))
    for cid, cobj in classes_dict.items():
        db_layer.put_class_ct(user_id, cid, encrypt_user_data(cobj, encryption_key))
    logger.info("Migrated user %s to v2 schema (%d classes)", user_id, len(classes_dict))
    return True


def _ensure_v2(user_id: str, encryption_key: bytes):
    """Migrate the user's record to v2 if it isn't already (no-op otherwise)."""
    if not encryption_key:
        return
    meta_rec = db_layer.get_meta_record(user_id)
    if meta_rec is None or meta_rec.get('version') == 2:
        return
    migrate_user_to_v2(user_id, encryption_key)


def save_user_data(user_id: str, data, encryption_key: bytes = None, session_token: str = None):
    """Save full user data using v2 split layout (legacy callers still work)."""
    if not encryption_key:
        raise ValueError("Encryption key is required to save user data securely")

    meta, classes_dict = _split_blob_for_v2(data or {})
    db_layer.put_meta_ct(user_id, encrypt_user_data(meta, encryption_key))

    # Write all current classes; remove any classes that are no longer present
    existing_ids = set(db_layer.list_class_ids(user_id))
    new_ids = set(classes_dict.keys())
    for cid, cobj in classes_dict.items():
        db_layer.put_class_ct(user_id, cid, encrypt_user_data(cobj, encryption_key))
    for cid in existing_ids - new_ids:
        db_layer.delete_class(user_id, cid)

    if session_token and session_token in user_data_cache:
        user_data_cache[session_token]["data"] = data
        user_data_cache[session_token]["last_heartbeat"] = datetime.now()


def _decrypt_v2_record(stored: dict, encryption_key: bytes) -> dict:
    """Decrypt + reassemble a v2 record into a full blob."""
    if not stored or not encryption_key:
        return {}
    meta = decrypt_user_data(stored.get('meta', ''), encryption_key) if stored.get('meta') else {}
    classes_dict = {}
    for cid, enc in (stored.get('classes') or {}).items():
        try:
            cobj = decrypt_user_data(enc, encryption_key)
            if cobj:
                classes_dict[cid] = cobj
        except Exception as e:
            logger.warning("Failed to decrypt class %s: %s", cid, type(e).__name__)
    return _assemble_blob_from_v2(meta, classes_dict)


def get_user_data(user_id: str, encryption_key: bytes = None):
    """Get full user data, transparently handling v2 + legacy v1 records."""
    meta_rec = db_layer.get_meta_record(user_id)
    if meta_rec is None:
        return {}

    if meta_rec.get('version') == 2:
        if not encryption_key:
            logger.warning("v2 data for user %s but no key provided", user_id)
            return {}
        # Build a v2 dict and reuse the existing decrypt helper
        class_ids = db_layer.list_class_ids(user_id)
        stored = {
            'version': 2,
            'encrypted': True,
            'meta': meta_rec.get('meta_ct', ''),
            'classes': {cid: db_layer.get_class_ct(user_id, cid) for cid in class_ids}
        }
        return _decrypt_v2_record(stored, encryption_key)

    # Legacy v1 single-blob
    legacy_ct = meta_rec.get('legacy_ct')
    if legacy_ct:
        if not meta_rec.get('encrypted'):
            # Plaintext record stored during migration — return as-is, no key needed.
            try:
                return json.loads(legacy_ct)
            except Exception:
                logger.warning("Failed to parse plaintext legacy record for user %s", user_id)
                return {}
        if encryption_key:
            return decrypt_user_data(legacy_ct, encryption_key)
        logger.warning("Encrypted data for user %s but no key provided", user_id)
        return {}

    return {}


def get_user_meta(user_id: str, encryption_key: bytes) -> dict:
    """Get just the meta block (small payload, fast)."""
    _ensure_v2(user_id, encryption_key)
    meta_rec = db_layer.get_meta_record(user_id)
    if meta_rec is None or meta_rec.get('version') != 2:
        return {}
    enc_meta = meta_rec.get('meta_ct')
    if not enc_meta:
        return {}
    return decrypt_user_data(enc_meta, encryption_key)


def save_user_meta(user_id: str, meta: dict, encryption_key: bytes):
    """Save only the meta block. Leaves per-class blobs untouched."""
    if not encryption_key:
        raise ValueError("Encryption key is required to save user data securely")
    _ensure_v2(user_id, encryption_key)
    # Defensive: meta must not contain a 'classes' field
    clean = {k: v for k, v in (meta or {}).items() if k != 'classes'}
    db_layer.put_meta_ct(user_id, encrypt_user_data(clean, encryption_key))


def get_user_class(user_id: str, class_id: str, encryption_key: bytes):
    """Get one decrypted class object. Returns None if not found."""
    _ensure_v2(user_id, encryption_key)
    meta_rec = db_layer.get_meta_record(user_id)
    if meta_rec is None or meta_rec.get('version') != 2:
        return None
    enc = db_layer.get_class_ct(user_id, str(class_id))
    if not enc:
        return None
    return decrypt_user_data(enc, encryption_key)


def save_user_class(user_id: str, class_id: str, class_obj: dict, encryption_key: bytes):
    """Save (insert or update) a single class blob."""
    if not encryption_key:
        raise ValueError("Encryption key is required to save user data securely")
    _ensure_v2(user_id, encryption_key)
    meta_rec = db_layer.get_meta_record(user_id)
    if meta_rec is None or meta_rec.get('version') != 2:
        db_layer.put_meta_ct(user_id, encrypt_user_data({'classOrder': []}, encryption_key))
    db_layer.put_class_ct(user_id, str(class_id), encrypt_user_data(class_obj, encryption_key))


def delete_user_class(user_id: str, class_id: str) -> bool:
    """Delete a single class blob. Returns True if it existed."""
    meta_rec = db_layer.get_meta_record(user_id)
    if meta_rec is None or meta_rec.get('version') != 2:
        return False
    return db_layer.delete_class(user_id, str(class_id))

def get_user_data_cached(user_id: str, session_token: str, encryption_key: bytes = None):
    """Get user data from cache or decrypt and cache it"""
    # Check cache first
    if session_token in user_data_cache:
        cache_entry = user_data_cache[session_token]
        # Check if cache is still valid (heartbeat not timed out)
        if (datetime.now() - cache_entry["last_heartbeat"]).total_seconds() < HEARTBEAT_TIMEOUT:
            print(f"Cache hit for user {user_id}")
            return cache_entry["data"]
        else:
            # Cache expired, remove it
            print(f"Cache expired for user {user_id}")
            del user_data_cache[session_token]

    # Cache miss - load and decrypt from disk
    print(f"Cache miss for user {user_id}, loading from disk")
    data = get_user_data(user_id, encryption_key)

    # Store in cache
    if data and session_token:
        user_data_cache[session_token] = {
            "data": data,
            "user_id": user_id,
            "last_heartbeat": datetime.now()
        }

    return data

def get_encryption_key_for_session(token: str) -> bytes | None:
    """Get the encryption key for a session token"""
    return encryption_keys.get(token)

def clear_session_cache(token: str):
    """Clear cache for a session"""
    if token in user_data_cache:
        del user_data_cache[token]
    if token in encryption_keys:
        del encryption_keys[token]

# ============ AUTHENTICATION FUNCTIONS ============

def register_user(username: str, email: str, password: str, account_type: str = 'teacher') -> dict:
    """Register a new user. account_type is 'teacher' (default, full gradebook) or
    'org_admin' (pure organisation-admin account, no personal gradebook)."""
    # Validate username
    username = username.strip()
    if len(username) < 3 or len(username) > 50:
        return {
            'success': False,
            'message': 'backend.usernameLength',
            'user_id': None
        }

    if not username.replace('_', '').isalnum():
        return {
            'success': False,
            'message': 'backend.usernameChars',
            'user_id': None
        }

    # Validate email
    email = email.strip().lower()
    if '@' not in email or '.' not in email:
        return {
            'success': False,
            'message': 'backend.invalidEmail',
            'user_id': None
        }

    # Validate password
    if len(password) < 8:
        return {
            'success': False,
            'message': 'backend.passwordLength',
            'user_id': None
        }

    # Check if user already exists
    if db_layer.get_user_by_email(email) is not None:
        return {
            'success': False,
            'message': 'backend.userExists',
            'user_id': None
        }

    # Generate unique ID using UUID to prevent collisions
    import uuid
    user_id = str(uuid.uuid4())[:8]

    max_attempts = 100
    attempts = 0
    while db_layer.get_user_by_id(user_id) is not None and attempts < max_attempts:
        user_id = str(uuid.uuid4())[:8]
        attempts += 1

    if db_layer.get_user_by_id(user_id) is not None:
        return {
            'success': False,
            'message': 'backend.error',
            'user_id': None
        }

    password_hash = hash_password(password)

    # Generate encryption salt (separate from password hash salt)
    encryption_salt = secrets.token_bytes(32)

    # Derive the data encryption key (DEK) from the password
    encryption_key = derive_encryption_key(password, encryption_salt)

    # Generate a recovery key and store an encrypted copy of the DEK
    recovery_key = generate_recovery_key()
    recovery_salt = secrets.token_bytes(32)
    recovery_derived_key = derive_key_from_recovery(recovery_key, recovery_salt)
    encrypted_dek = encrypt_bytes(encryption_key, recovery_derived_key)

    db_layer.put_user(email, {
        "id": user_id,
        "username": username,
        "email": email,
        "password_hash": password_hash,
        "encryption_salt": encryption_salt.hex(),
        "recovery_key_hash": hash_recovery_key(recovery_key),
        "recovery_salt": recovery_salt.hex(),
        "encrypted_dek": encrypted_dek,
        "account_type": account_type,
        "created_at": datetime.now().isoformat()
    })

    # Initialize user data (will be encrypted)
    initial_data = {
        "teacherName": "",
        "currentClassId": None,
        "classes": [],
        "categories": [],
        "students": [],
        "participationSettings": {"plusValue": 0.5, "minusValue": 0.5},
        "plusMinusGradeSettings": {"startGrade": 3, "plusValue": 0.5, "minusValue": 0.5},
        "tutorial": {"completed": False, "neverShowAgain": False},
        "gradePercentageRanges": [
            {"grade": 1, "minPercent": 85, "maxPercent": 100},
            {"grade": 2, "minPercent": 70, "maxPercent": 84},
            {"grade": 3, "minPercent": 55, "maxPercent": 69},
            {"grade": 4, "minPercent": 40, "maxPercent": 54},
            {"grade": 5, "minPercent": 0, "maxPercent": 39}
        ]
    }

    encrypted_data = encrypt_user_data(initial_data, encryption_key)
    db_layer.put_legacy_record(user_id, encrypted_data)

    return {
        'success': True,
        'message': 'backend.registrationSuccess',
        'user_id': user_id,
        'recovery_key': recovery_key
    }

def _list_active_sessions_for_user(user_id: str) -> list[str]:
    """Return all non-expired session tokens belonging to this user."""
    now = datetime.now()
    active = []
    for tok, sess in db_layer.iter_sessions():
        if sess.get('user_id') != user_id:
            continue
        try:
            if datetime.fromisoformat(sess.get('expires_at', '')) < now:
                continue
        except (TypeError, ValueError):
            continue
        active.append(tok)
    return active


def _terminate_user_sessions(user_id: str) -> int:
    """Delete all sessions for a user and clear in-memory caches/keys.
    Returns the number of sessions removed.
    """
    tokens = [t for t, s in db_layer.iter_sessions() if s.get('user_id') == user_id]
    for tok in tokens:
        db_layer.delete_session(tok)
        clear_session_cache(tok)
    return len(tokens)


def login_user(email: str, password: str, force: bool = False, long_session: bool = False) -> dict:
    """Log in a user.

    `long_session=True` (native app clients) issues a 6-month session instead of
    the default 1-hour web session, so app users don't have to re-authenticate
    constantly. Web sessions stay short-lived.
    """
    email = email.strip().lower()

    user = db_layer.get_user_by_email(email)

    # Per-account lockout: independent of per-IP rate limiting, so distributed
    # brute-force across many IPs still hits an account-level wall.
    LOCKOUT_THRESHOLD = 10        # consecutive failures
    LOCKOUT_DURATION_SECONDS = 900  # 15 min
    if user:
        locked_until = user.get('locked_until_ts', 0)
        now_ts = int(time.time())
        if locked_until and now_ts < locked_until:
            return {
                'success': False,
                'message': 'backend.accountLocked',
                'message_params': {'seconds': locked_until - now_ts},
                'token': None,
                'user': None
            }

    # Constant-time-ish path: always run a PBKDF2 verify even when the user
    # does not exist, so the response time does not reveal account presence.
    if not user:
        # Dummy hash with same iteration count as real hashes — deliberately
        # do work then fail. salt/hash content is irrelevant.
        _dummy = "00" * 32 + ":" + "00" * 32
        verify_password(_dummy, password)
        return {
            'success': False,
            'message': 'backend.invalidCredentials',
            'token': None,
            'user': None
        }
    if not verify_password(user["password_hash"], password):
        # Atomically increment the failure counter to prevent lost updates under
        # concurrency (two concurrent wrong-password attempts could both read the
        # same count, increment to the same value, and both write back, counting
        # as only one failure). The DB helper issues a single UPDATE+json_set.
        fails = db_layer.increment_failed_login(email)
        if fails >= LOCKOUT_THRESHOLD:
            db_layer.set_lockout(email, int(time.time()) + LOCKOUT_DURATION_SECONDS)
            return {
                'success': False,
                'message': 'backend.accountLocked',
                'message_params': {'seconds': LOCKOUT_DURATION_SECONDS},
                'token': None,
                'user': None
            }
        return {
            'success': False,
            'message': 'backend.invalidCredentials',
            'token': None,
            'user': None
        }

    # Successful auth: atomically reset fail counter + lockout state.
    db_layer.reset_failed_login(email)

    # Single-session enforcement: only one active session per user. If another
    # one already exists, refuse the login unless the caller explicitly opts
    # in to take over (`force=True`), in which case the old sessions are
    # invalidated first.
    user_id = user["id"]
    existing_tokens = _list_active_sessions_for_user(user_id)
    if existing_tokens and not force:
        return {
            'success': False,
            'message': 'backend.sessionAlreadyActive',
            'code': 'session_exists',
            'token': None,
            'user': None
        }
    if existing_tokens and force:
        removed = _terminate_user_sessions(user_id)
        logger.info("Force-login for user %s terminated %d existing session(s)", user_id, removed)

    # Create session. App clients get a long-lived (6-month) session; web stays at 1h.
    token = generate_session_token()
    session_ttl = timedelta(days=180) if long_session else timedelta(hours=1)
    expires_at = (datetime.now() + session_ttl).isoformat()

    db_layer.put_session(token, {
        "user_id": user["id"],
        "created_at": datetime.now().isoformat(),
        "expires_at": expires_at,
        "long_session": long_session
    })

    # Handle encryption key
    user_id = user["id"]
    encryption_salt_hex = user.get("encryption_salt")

    if not encryption_salt_hex:
        # Legacy user without encryption - create encryption salt now
        print(f"Creating encryption salt for legacy user {user_id}")
        encryption_salt = secrets.token_bytes(32)
        user["encryption_salt"] = encryption_salt.hex()
        db_layer.put_user(email, user)
        encryption_salt_hex = encryption_salt.hex()

    # Derive encryption key
    encryption_salt = bytes.fromhex(encryption_salt_hex)
    encryption_key = derive_encryption_key(password, encryption_salt)
    encryption_keys[token] = encryption_key

    # Migrate to v2 split layout if still on legacy single-blob v1
    # (handles both encrypted and plaintext v1 records; migrate_user_to_v2
    # correctly branches on meta_rec['encrypted'] now that the key is available)
    try:
        migrate_user_to_v2(user_id, encryption_key)
    except Exception as e:
        logger.warning("v2 migration failed for user %s: %s", user_id, type(e).__name__)

    # Reload user to get any updates
    user = db_layer.get_user_by_email(email) or user
    needs_recovery_key = not user.get('recovery_key_hash')

    return {
        'success': True,
        'message': 'backend.loginSuccess',
        'token': token,
        'needs_recovery_key': needs_recovery_key,
        'user': {
            'id': user['id'],
            'username': user['username'],
            'email': user['email']
        }
    }

def logout_user(token: str) -> bool:
    """Log out a user by invalidating their session"""
    db_layer.delete_session(token)
    clear_session_cache(token)
    return True

def get_user_from_token(token: str) -> dict | None:
    """Get user from session token"""
    if not token:
        return None

    session = db_layer.get_session(token)
    if not session:
        return None

    # Check if session is expired
    expires_at = datetime.fromisoformat(session['expires_at'])
    if expires_at < datetime.now():
        return None

    user_id = session['user_id']
    user_info = db_layer.get_user_by_id(user_id)
    if user_info:
        return {
            'id': user_info['id'],
            'username': user_info['username'],
            'email': user_info['email'],
            'account_type': user_info.get('account_type', 'teacher')
        }
    return None

def get_token_from_request():
    """Extract session token from request (cookie or header)"""
    # Try cookie first
    token = request.cookies.get('session_token')
    if token:
        return token

    # Try Authorization header
    auth_header = request.headers.get('Authorization', '')
    if auth_header.startswith('Bearer '):
        return auth_header[7:]

    return ""

def login_required(f):
    """Decorator to require authentication for routes"""
    
    @functools.wraps(f)
    async def decorated_function(*args, **kwargs):
        token: str = get_token_from_request()
        user = get_user_from_token(token)

        if not user:
            return jsonify({'error': 'Authentication required'}), 401

        # Add user to request context
        request.user = user # type: ignore
        return await f(*args, **kwargs)

    # Give the function a unique name to avoid conflicts
    decorated_function.__name__ = f"{f.__name__}_login_required"
    return decorated_function


def org_member_required(f):
    """Decorator (stack after login_required) requiring an approved org membership.
    Attaches request.org_id / request.org_role.
    """
    @functools.wraps(f)
    async def decorated_function(*args, **kwargs):
        membership = db_layer.get_org_membership(request.user['id'])  # type: ignore
        if not membership or membership.get('status') != 'approved':
            return jsonify({'success': False, 'message': 'backend.orgNotMember'}), 403
        request.org_id = membership['org_id']  # type: ignore
        request.org_role = membership['role']  # type: ignore
        return await f(*args, **kwargs)
    decorated_function.__name__ = f"{f.__name__}_org_member_required"
    return decorated_function


def org_admin_required(f):
    """Decorator (stack after login_required) requiring org admin role."""
    @functools.wraps(f)
    async def decorated_function(*args, **kwargs):
        membership = db_layer.get_org_membership(request.user['id'])  # type: ignore
        if not membership or membership.get('status') != 'approved' or membership.get('role') != 'admin':
            return jsonify({'success': False, 'message': 'backend.orgNotAdmin'}), 403
        request.org_id = membership['org_id']  # type: ignore
        request.org_role = membership['role']  # type: ignore
        return await f(*args, **kwargs)
    decorated_function.__name__ = f"{f.__name__}_org_admin_required"
    return decorated_function

# Load version from config file
def load_version():
    """Load version information from version.json"""
    try:
        version_file = Path(__file__).parent / "version.json"
        with open(version_file, 'r', encoding='utf-8') as f:
            version_data = json.load(f)
        return version_data.get('version', '1.0.0'), version_data.get('build', '')
    except Exception as e:
        print(f"Warning: Could not load version.json: {e}")
        return '1.0.0', ''

APP_VERSION, BUILD_DATE = load_version()
VERSION_STRING = f"v{APP_VERSION} ({BUILD_DATE})" if BUILD_DATE else f"v{APP_VERSION}"

app = Quart(__name__,
            template_folder='templates',
            static_folder='static',
            static_url_path='/static')

# Use secret key from config (auto-generated on first start)
app.secret_key = APP_CONFIG['secret_key']



@app.before_serving
async def startup():
    """Initialize SQLite database and run JSON migration if needed."""
    print("Initializing SQLite database...")
    init_db()
    # Legacy JSON→SQLite migration. Module may be absent on deployments that
    # never ran the JSON backend — only fatal if a legacy edugrade.json
    # actually needs migrating.
    try:
        from migrate_json_to_db import migrate_json_to_db
        migrate_json_to_db()
    except ImportError:
        legacy_json = DATA_DIR / "edugrade.json"
        if legacy_json.exists():
            logger.error(
                "migrate_json_to_db.py missing but %s exists — deploy the "
                "migration module, otherwise legacy data stays unmigrated!",
                legacy_json
            )
            raise
        logger.info("migrate_json_to_db.py not deployed; no legacy JSON found, skipping.")
    migrate_plaintext_shares()
    purge_stored_recovery_key_copies()
    await cleanup_expired_sessions()
    print("Database initialized successfully")

# CSRF defence: require X-Requested-With on cookie-authenticated state-changing
# requests. Browsers will not let cross-origin <form> submissions or top-level
# navigations attach custom headers, so a forged request cannot satisfy this
# check. Public/PIN-protected share endpoints are exempt because they do not
# rely on session cookies.
_CSRF_EXEMPT_PREFIXES = (
    '/api/login',
    '/api/register',
    '/api/logout',
    '/api/password-reset',
    # NOTE: /api/recovery-key/* is intentionally NOT exempt anymore — both
    # endpoints are session-authenticated and state-changing (key rotation).
    '/api/share/verify',  # public share PIN verification, no cookie auth
    '/api/share/access',  # public share access, no cookie auth
    '/api/grades/',       # public class-share grade view (token-based)
)

@app.before_request
async def _csrf_guard():
    method = request.method.upper()
    if method in ('GET', 'HEAD', 'OPTIONS'):
        return None
    path = request.path or ''
    for prefix in _CSRF_EXEMPT_PREFIXES:
        if path.startswith(prefix):
            return None
    # Only enforce on JSON API routes (state-changing endpoints under /api/).
    if not path.startswith('/api/'):
        return None
    if request.headers.get('X-Requested-With') != 'XMLHttpRequest':
        return jsonify({
            'success': False,
            'message': 'backend.csrfRequired'
        }), 403
    return None

@app.after_request
async def set_cache_control_headers(response):
    """
    Set Cache-Control headers to prevent stale cache issues on mobile/desktop.
    
    This ensures CSS, JS, and other static assets are always fetched fresh from
    the server instead of using cached versions. The version query parameter
    (?v=VERSION) provides additional cache busting for deployments.
    
    Headers used:
    - no-cache: Revalidate with server before using cached version
    - no-store: Don't store in cache at all
    - must-revalidate: Must check with server after expiry
    - max-age=0: Cache expires immediately
    """
    path = request.path
    
    # HTML too: pages carry user data and the security headers below, so a
    # disk-cached copy would keep serving a stale Content-Security-Policy.
    if path.startswith('/static/') or response.mimetype == 'text/html':
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'

    response.headers.setdefault('X-Frame-Options', 'DENY')
    response.headers.setdefault('X-Content-Type-Options', 'nosniff')
    response.headers.setdefault('Referrer-Policy', 'strict-origin-when-cross-origin')
    # Content-Security-Policy. 'unsafe-inline' for script/style is a known
    # limitation: the app relies on inline <script> blocks and onclick handlers.
    # ponytail: unsafe-inline stays until inline handlers move to addEventListener
    # + nonces; the other directives already block external script injection,
    # <base> hijacking, framing and cross-origin form posts.
    response.headers.setdefault('Content-Security-Policy', (
        "default-src 'self'; "
        # jsdelivr: tailwind + basecoat-css (both SRI-pinned in the templates).
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; "
        "img-src 'self' data:; "
        "font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com; "
        "connect-src 'self'; "
        # Ko-fi donation widget in the support dialog.
        "frame-src https://ko-fi.com; "
        "object-src 'none'; "
        "base-uri 'none'; "
        "frame-ancestors 'none'; "
        "form-action 'self'"
    ))
    # HSTS only when serving over TLS (COOKIE_SECURE ⇒ prod/HTTPS), so plain-HTTP
    # local dev is not forced onto HTTPS.
    if COOKIE_SECURE:
        response.headers.setdefault(
            'Strict-Transport-Security', 'max-age=63072000; includeSubDomains'
        )

    return response

# ============ Startup ============


# ============ Page Routes ============

@app.route('/')
async def index():
    """Main page - requires login"""
    token = get_token_from_request()
    user = get_user_from_token(token)

    if not user:
        return redirect(url_for('login_page'))

    return await render_template('index.html', user=user, app_version=APP_VERSION, version_string=VERSION_STRING, build_date=BUILD_DATE)


@app.route('/login')
async def login_page():
    """Login/Register page"""
    token = get_token_from_request()
    user = get_user_from_token(token)

    # Only auto-redirect into the app if the session is *fully* usable: a
    # valid token AND an in-memory encryption key. After a server restart the
    # token may still verify but the key is gone — without this guard the
    # user gets stuck in /login → / → 401 → /login redirect loop.
    if user and get_encryption_key_for_session(token):
        return redirect(url_for('index'))

    return await render_template('login.html', app_version=APP_VERSION)


@app.route('/terms')
async def terms():
    return await render_template('terms.html', app_version=APP_VERSION)

@app.route('/privacy')
async def privacy():
    return await render_template('privacy.html', app_version=APP_VERSION)

@app.route('/docs')
@app.route('/docs/')
@app.route('/docs/<path:slug>')
async def docs(slug='intro'):
    """In-app documentation (replaces the standalone Docusaurus site)."""
    page = docs_render.render_page(slug)
    if page is None:
        return await render_template('docs.html',
                                     page=docs_render.render_page('intro'),
                                     nav=docs_render.build_nav('intro'),
                                     app_version=APP_VERSION), 404
    return await render_template('docs.html',
                                 page=page,
                                 nav=docs_render.build_nav(page['slug']),
                                 app_version=APP_VERSION)

@app.route('/service-worker.js')
async def service_worker():
    """Serve service worker from root scope"""
    response = await send_file('static/service-worker.js')
    response.headers['Cache-Control'] = 'no-cache'
    response.headers['Service-Worker-Allowed'] = '/'
    response.headers['Content-Type'] = 'application/javascript'
    return response


@app.route('/.well-known/assetlinks.json')
async def assetlinks():
    """Digital Asset Links for TWA verification"""
    response = await send_file('static/.well-known/assetlinks.json')
    response.headers['Content-Type'] = 'application/json'
    return response


@app.route('/about.html')
async def about_page():
    """About page"""
    return await send_file('about.html')


@app.route('/about_developer.html')
async def about_developer_page():
    """About developer page"""
    return await send_file('about_developer.html')


# ============ Version API ============

@app.route('/api/version')
async def api_version():
    """Return current app version for update detection"""
    return jsonify({
        'version': APP_VERSION,
        'build': BUILD_DATE,
        'version_string': VERSION_STRING
    })


# ============ Native Android app distribution ============
# The native APK is distributed by sideload (beta). The manifest lives in the
# repo (version-controlled); the binary itself sits in EDUGRADE_APK_DIR on the
# server (a mounted volume in prod), so the heavy file never lands in git.

APK_MANIFEST_PATH = Path(__file__).parent / 'mobile-apps' / 'release' / 'apk-manifest.json'
APK_DIR = os.environ.get('EDUGRADE_APK_DIR', str(Path(__file__).parent / 'mobile-apps' / 'release'))


def load_apk_manifest():
    """Read the APK release manifest, or None if not published yet."""
    try:
        with open(APK_MANIFEST_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


@app.route('/api/app/latest')
async def api_app_latest():
    """Latest native Android APK metadata — used by the web download modal and
    the in-app update banner."""
    manifest = load_apk_manifest()
    if not manifest:
        return jsonify({'available': False}), 404
    data = dict(manifest)
    data['available'] = True
    data['downloadUrl'] = '/download/edugrade.apk'
    return jsonify(data)


@app.route('/download/edugrade.apk')
async def download_apk():
    """Serve the published APK as a download."""
    manifest = load_apk_manifest()
    fname = (manifest or {}).get('fileName')
    if not fname:
        return ('APK not published yet.', 404)
    path = os.path.join(APK_DIR, fname)
    if not os.path.exists(path):
        return ('APK file missing on server.', 404)
    response = await make_response(
        await send_file(path, mimetype='application/vnd.android.package-archive')
    )
    response.headers['Content-Disposition'] = f'attachment; filename="{fname}"'
    return response


# ============ Auth API ============

@app.route('/api/register', methods=['POST'])
@rate_limit('register')
async def api_register():
    """Register a new user"""
    data = await request.get_json()

    if not data:
        return jsonify({'success': False, 'message': 'backend.invalidRequest'}), 400

    username = data.get('username', '')
    email = data.get('email', '')
    password = data.get('password', '')
    password_confirm = data.get('password_confirm', '')

    if not all([username, email, password, password_confirm]):
        return jsonify({'success': False, 'message': 'backend.fillAllFields'}), 400

    if password != password_confirm:
        return jsonify({'success': False, 'message': 'backend.passwordsMismatch'}), 400

    result = register_user(username, email, password)
    status_code = 200 if result['success'] else 400

    return jsonify(result), status_code


@app.route('/api/register-org', methods=['POST'])
@rate_limit('register')
async def api_register_org():
    """Register a pure organisation-admin account and create its org."""
    data = await request.get_json()

    if not data:
        return jsonify({'success': False, 'message': 'backend.invalidRequest'}), 400

    org_name = data.get('org_name', '')
    username = data.get('username', '')
    email = data.get('email', '')
    password = data.get('password', '')
    password_confirm = data.get('password_confirm', '')

    if not all([org_name, username, email, password, password_confirm]):
        return jsonify({'success': False, 'message': 'backend.fillAllFields'}), 400

    if password != password_confirm:
        return jsonify({'success': False, 'message': 'backend.passwordsMismatch'}), 400

    result = register_org_admin(org_name, username, email, password)
    status_code = 200 if result['success'] else 400

    return jsonify(result), status_code


@app.route('/api/login', methods=['POST'])
@rate_limit('login')
async def api_login():
    """Log in a user"""
    data = await request.get_json()

    if not data:
        return jsonify({'success': False, 'message': 'backend.invalidRequest'}), 400

    email = data.get('email', '')
    password = data.get('password', '')
    force = bool(data.get('force', False))
    # Native app clients identify themselves to get a long-lived session.
    long_session = str(data.get('client', '')).lower() in ('app', 'android', 'mobile')

    if not email or not password:
        return jsonify({'success': False, 'message': 'backend.fillAllFields'}), 400

    result = login_user(email, password, force=force, long_session=long_session)

    if result.get('code') == 'session_exists':
        # 409 Conflict: client must confirm before we kill the other session.
        return jsonify(result), 409

    if result['success']:
        response = await make_response(jsonify(result))
        # Match the cookie lifetime to the session TTL (6 months for the app, 1h for web).
        max_age = (180 * 24 * 60 * 60) if long_session else (1 * 60 * 60)
        response.set_cookie(
            'session_token',
            result['token'],
            httponly=True,
            secure=COOKIE_SECURE,
            samesite='Lax',
            max_age=max_age
        )
        return response

    return jsonify(result), 401


@app.route('/api/logout', methods=['POST'])
async def api_logout():
    """Log out the current user"""
    token = get_token_from_request()

    if token:
        logout_user(token)

    response = await make_response(jsonify({'success': True, 'message': 'backend.loggedOut'}))
    response.delete_cookie('session_token')
    return response


@app.route('/api/password-reset', methods=['POST'])
@rate_limit('password_reset')
async def api_password_reset():
    """Reset password using recovery key — re-encrypts data with new password, no data loss"""
    data = await request.get_json()

    if not data:
        return jsonify({'success': False, 'message': 'backend.invalidRequest'}), 400

    email = data.get('email', '').strip().lower()
    recovery_key = data.get('recovery_key', '').strip()
    new_password = data.get('new_password', '')

    if not all([email, recovery_key, new_password]):
        return jsonify({'success': False, 'message': 'backend.fillAllFields'}), 400

    if len(new_password) < 8:
        return jsonify({'success': False, 'message': 'backend.passwordLength'}), 400

    user = db_layer.get_user_by_email(email)

    # Always return the same error to prevent user enumeration
    if not user:
        return jsonify({'success': False, 'message': 'backend.recoveryKeyInvalid'}), 400

    # Check that recovery key infrastructure exists for this account
    if not user.get('recovery_key_hash') or not user.get('recovery_salt') or not user.get('encrypted_dek'):
        return jsonify({'success': False, 'message': 'backend.noRecoveryKey'}), 400

    # Verify the recovery key
    if not verify_recovery_key(user['recovery_key_hash'], recovery_key):
        return jsonify({'success': False, 'message': 'backend.recoveryKeyInvalid'}), 400

    try:
        # Decrypt the stored DEK using the recovery key
        recovery_salt = bytes.fromhex(user['recovery_salt'])
        recovery_derived_key = derive_key_from_recovery(recovery_key, recovery_salt)
        dek = decrypt_bytes(user['encrypted_dek'], recovery_derived_key)

        # Load and decrypt the user's data with the recovered DEK
        user_id = user['id']
        user_data = get_user_data(user_id, dek)

        # Derive a new DEK from the new password
        new_encryption_salt = secrets.token_bytes(32)
        new_dek = derive_encryption_key(new_password, new_encryption_salt)

        # Re-encrypt the user data with the new DEK (stored as legacy v1 blob;
        # next login will migrate it to v2)
        encrypted_data = encrypt_user_data(user_data, new_dek)
        db_layer.put_legacy_record(user_id, encrypted_data)

        # Encrypt the new DEK with the same recovery key (so recovery still works)
        new_recovery_salt = secrets.token_bytes(32)
        new_recovery_derived_key = derive_key_from_recovery(recovery_key, new_recovery_salt)
        new_encrypted_dek = encrypt_bytes(new_dek, new_recovery_derived_key)

        # Update user record
        user['password_hash'] = hash_password(new_password)
        user['encryption_salt'] = new_encryption_salt.hex()
        user['recovery_salt'] = new_recovery_salt.hex()
        user['encrypted_dek'] = new_encrypted_dek
        db_layer.put_user(email, user)

        # Invalidate all existing sessions for this user
        for t, s in db_layer.iter_sessions():
            if s.get("user_id") == user_id:
                db_layer.delete_session(t)
                encryption_keys.pop(t, None)
                user_data_cache.pop(t, None)

        return jsonify({'success': True, 'message': 'backend.passwordResetSuccess'})

    except Exception as e:
        print(f"Password reset error: {e}")
        return jsonify({'success': False, 'message': 'backend.error'}), 500


@app.route('/api/password-reset/email-request', methods=['POST'])
@rate_limit('password_reset')
async def api_password_reset_email_request():
    """Request a password reset link by email (for accounts without a recovery key).
    Always returns the same message to prevent user enumeration."""
    data = await request.get_json()
    if not data:
        return jsonify({'success': False, 'message': 'backend.invalidRequest'}), 400

    email = data.get('email', '').strip().lower()
    if not email:
        return jsonify({'success': False, 'message': 'backend.fillAllFields'}), 400

    if not smtp_is_configured():
        return jsonify({'success': False, 'message': 'backend.smtpNotConfigured'}), 400

    # Always respond the same way regardless of whether email exists
    generic_ok = jsonify({'success': True, 'message': 'backend.resetEmailSent'})

    user = db_layer.get_user_by_email(email)
    if not user:
        return generic_ok

    # Only allow email reset if there is NO recovery key (otherwise use recovery key flow)
    if user.get('recovery_key_hash'):
        # Silently succeed so as not to reveal whether recovery key exists
        return generic_ok

    # Generate a time-limited reset token (1 hour)
    reset_token = secrets.token_urlsafe(32)
    expires_at = (datetime.now() + timedelta(hours=1)).isoformat()

    db_layer.put_reset_token(reset_token, {
        'user_email': email,
        'expires_at': expires_at,
        'used': False
    })

    try:
        await send_password_reset_email(email, user.get('username', email), reset_token)
    except Exception as e:
        logger.warning("Failed to send reset email to %s: %s", _scrub_email(email), e)
        # Don't reveal the error to the client

    return generic_ok


@app.route('/api/recovery-key/email-request', methods=['POST'])
@rate_limit('password_reset')
@login_required
async def api_recovery_key_email_request():
    """Email the recovery kit (PDF) to the logged-in user's own address.

    SECURITY: This endpoint requires an authenticated session. The server keeps
    no decryptable copy of the recovery key, so the key is ROTATED here: a new
    recovery key is generated from the session DEK, emailed, and returned in
    the response (so the UI can show the now-valid key). Any previously issued
    recovery key becomes invalid. The old unauthenticated flow (decrypt stored
    key, mail to any requested address) allowed full account takeover for
    anyone with access to the user's mailbox.
    """
    token = get_token_from_request()
    user_id = request.user['id']  # type: ignore
    user_email = request.user['email']  # type: ignore

    if not smtp_is_configured():
        return jsonify({'success': False, 'message': 'backend.smtpNotConfigured'}), 400

    dek = encryption_keys.get(token)
    if not dek:
        return jsonify({'success': False, 'message': 'backend.sessionExpired', 'requireRelogin': True}), 401

    user = db_layer.get_user_by_email(user_email)
    if not user:
        return jsonify({'success': False, 'message': 'backend.error'}), 500

    # Generate the new recovery key wrapping the current DEK.
    new_recovery_key = generate_recovery_key()
    new_recovery_salt = secrets.token_bytes(32)
    new_recovery_derived_key = derive_key_from_recovery(new_recovery_key, new_recovery_salt)
    new_encrypted_dek = encrypt_bytes(dek, new_recovery_derived_key)

    # Language preference from the user's (already decrypted) data
    language = 'de'
    try:
        user_data = get_user_data_cached(user_id, token, dek)
        if isinstance(user_data, dict):
            language = user_data.get('language', 'de')
    except Exception as e:
        logger.info("Could not determine language preference: %s", type(e).__name__)

    # Send first, persist only on success — a failed send must not invalidate
    # the user's existing (printed/saved) recovery key.
    try:
        await send_recovery_key_email(user_email, user.get('username', user_email), new_recovery_key, language)
    except Exception as e:
        logger.warning("Failed to send recovery key email to %s: %s", _scrub_email(user_email), e)
        return jsonify({'success': False, 'message': 'backend.error'}), 500

    user['recovery_key_hash'] = hash_recovery_key(new_recovery_key)
    user['recovery_salt'] = new_recovery_salt.hex()
    user['encrypted_dek'] = new_encrypted_dek
    user.pop('encrypted_recovery_key', None)
    db_layer.put_user(user_email, user)

    return jsonify({
        'success': True,
        'message': 'backend.recoveryKeyEmailSent',
        'recovery_key': new_recovery_key
    })


@app.route('/api/password-reset/confirm-token', methods=['POST'])
@rate_limit('password_reset')
async def api_password_reset_confirm_token():
    """Reset password using an email token. DATA IS WIPED since no recovery key is available."""
    data = await request.get_json()
    if not data:
        return jsonify({'success': False, 'message': 'backend.invalidRequest'}), 400

    token = data.get('token', '').strip()
    new_password = data.get('new_password', '')

    if not token or not new_password:
        return jsonify({'success': False, 'message': 'backend.fillAllFields'}), 400

    if len(new_password) < 8:
        return jsonify({'success': False, 'message': 'backend.passwordLength'}), 400

    token_entry = db_layer.get_reset_token(token)

    if not token_entry:
        return jsonify({'success': False, 'message': 'backend.resetTokenInvalid'}), 400

    if token_entry.get('used'):
        return jsonify({'success': False, 'message': 'backend.resetTokenInvalid'}), 400

    if datetime.fromisoformat(token_entry['expires_at']) < datetime.now():
        return jsonify({'success': False, 'message': 'backend.resetTokenExpired'}), 400

    email = token_entry['user_email']
    user = db_layer.get_user_by_email(email)
    if not user:
        return jsonify({'success': False, 'message': 'backend.resetTokenInvalid'}), 400

    try:
        user_id = user['id']

        # Generate new password hash and encryption key (data will be fresh/empty)
        new_encryption_salt = secrets.token_bytes(32)
        new_dek = derive_encryption_key(new_password, new_encryption_salt)

        # Reset user data to empty initial state
        initial_data = {
            "teacherName": "",
            "currentClassId": None,
            "classes": [],
            "categories": [],
            "students": [],
            "participationSettings": {"plusValue": 0.5, "minusValue": 0.5},
            "plusMinusGradeSettings": {"startGrade": 3, "plusValue": 0.5, "minusValue": 0.5},
            "tutorial": {"completed": False, "neverShowAgain": False},
            "gradePercentageRanges": [
                {"grade": 1, "minPercent": 85, "maxPercent": 100},
                {"grade": 2, "minPercent": 70, "maxPercent": 84},
                {"grade": 3, "minPercent": 55, "maxPercent": 69},
                {"grade": 4, "minPercent": 40, "maxPercent": 54},
                {"grade": 5, "minPercent": 0, "maxPercent": 39}
            ]
        }
        encrypted_data = encrypt_user_data(initial_data, new_dek)
        db_layer.put_legacy_record(user_id, encrypted_data)

        # Generate a new recovery key so the account is protected going forward
        new_recovery_key = generate_recovery_key()
        new_recovery_salt = secrets.token_bytes(32)
        new_recovery_derived_key = derive_key_from_recovery(new_recovery_key, new_recovery_salt)
        new_encrypted_dek = encrypt_bytes(new_dek, new_recovery_derived_key)

        user['password_hash'] = hash_password(new_password)
        user['encryption_salt'] = new_encryption_salt.hex()
        user['recovery_key_hash'] = hash_recovery_key(new_recovery_key)
        user['recovery_salt'] = new_recovery_salt.hex()
        user['encrypted_dek'] = new_encrypted_dek
        db_layer.put_user(email, user)

        # Invalidate all existing sessions
        for t, s in db_layer.iter_sessions():
            if s.get("user_id") == user_id:
                db_layer.delete_session(t)
                encryption_keys.pop(t, None)
                user_data_cache.pop(t, None)

        # Mark token as used
        token_entry['used'] = True
        db_layer.put_reset_token(token, token_entry)

        return jsonify({
            'success': True,
            'message': 'backend.passwordResetSuccess',
            'recovery_key': new_recovery_key
        })

    except Exception as e:
        print(f"Token password reset error: {e}")
        return jsonify({'success': False, 'message': 'backend.error'}), 500


@app.route('/api/recovery-key/generate', methods=['POST'])
@login_required
async def api_generate_recovery_key():
    """Generate (or regenerate) a recovery key for the current user.
    Uses the DEK already held in the session — no password required."""
    token = get_token_from_request()
    user_id = request.user['id']  # type: ignore
    user_email = request.user['email']  # type: ignore

    # Get the current DEK from the session cache
    dek = encryption_keys.get(token)
    if not dek:
        return jsonify({'success': False, 'message': 'backend.sessionExpired'}), 401

    try:
        user = db_layer.get_user_by_email(user_email)
        if not user:
            return jsonify({'success': False, 'message': 'backend.error'}), 500

        # Generate a new recovery key and encrypt the DEK with it
        new_recovery_key = generate_recovery_key()
        new_recovery_salt = secrets.token_bytes(32)
        new_recovery_derived_key = derive_key_from_recovery(new_recovery_key, new_recovery_salt)
        new_encrypted_dek = encrypt_bytes(dek, new_recovery_derived_key)

        user['recovery_key_hash'] = hash_recovery_key(new_recovery_key)
        user['recovery_salt'] = new_recovery_salt.hex()
        user['encrypted_dek'] = new_encrypted_dek
        # Drop any legacy server-decryptable recovery key copy
        user.pop('encrypted_recovery_key', None)
        db_layer.put_user(user_email, user)

        return jsonify({'success': True, 'recovery_key': new_recovery_key})

    except Exception as e:
        print(f"Recovery key generation error: {e}")
        return jsonify({'success': False, 'message': 'backend.error'}), 500


@app.route('/api/account', methods=['DELETE'])
@login_required
async def api_delete_account():
    """Delete user account and all associated data"""
    user_id = request.user['id'] # type: ignore
    user_email = request.user['email'] # type: ignore

    try:
        db_layer.delete_user_data(user_id)
        # Purge every session for this user from DB and in-memory caches so no
        # other active session retains stale encryption keys or data.
        _terminate_user_sessions(user_id)
        db_layer.delete_user(user_email)

        response = await make_response(jsonify({'success': True, 'message': 'backend.accountDeleted'}))
        response.delete_cookie('session_token')
        return response

    except Exception as e:
        print(f"Error deleting account for user {user_id}: {str(e)}")
        return jsonify({'success': False, 'message': 'backend.error'}), 500


# ============ Data Sync API ============

@app.route('/api/data', methods=['GET'])
@rate_limit('data_read')
@login_required
async def api_get_data():
    """Get all data for the current user (cached)"""
    user_id = request.user['id'] # type: ignore
    token = get_token_from_request()
    encryption_key = get_encryption_key_for_session(token)

    # SECURITY/UX: Without an in-memory encryption key (e.g. after a server
    # restart) we cannot decrypt or encrypt this user's data. The session
    # cookie may still be valid but is useless on its own — force a re-login
    # instead of silently handing back an empty blob, which the frontend
    # would otherwise treat as a fresh account and drop the user into the
    # setup wizard.
    if not encryption_key:
        return jsonify({
            'success': False,
            'message': 'backend.sessionExpired',
            'requireRelogin': True
        }), 401

    try:
        print(f"Loading data for user {user_id}")
        # Use cached data if available
        user_data = get_user_data_cached(user_id, token, encryption_key)

        if not user_data:
            print(f"No data found for user {user_id}, returning empty default (not saved)")
            # Return minimal default for new users. We intentionally do NOT
            # call save_user_data here — saving empty data when get_user_data
            # unexpectedly returns falsy (e.g. due to a transient decryption
            # issue) would silently overwrite an existing user's classes.
            # The frontend will save real data when the user completes setup.
            user_data = {
                'teacherName': '',
                'currentClassId': None,
                'classes': [],
                'categories': [],
                'students': [],
                'participationSettings': {'plusValue': 0.5, 'minusValue': 0.5},
                'plusMinusGradeSettings': {'startGrade': 3, 'plusValue': 0.5, 'minusValue': 0.5},
                'tutorial': {'completed': False, 'neverShowAgain': False},
                'gradePercentageRanges': [
                    {'grade': 1, 'minPercent': 85, 'maxPercent': 100},
                    {'grade': 2, 'minPercent': 70, 'maxPercent': 84},
                    {'grade': 3, 'minPercent': 55, 'maxPercent': 69},
                    {'grade': 4, 'minPercent': 40, 'maxPercent': 54},
                    {'grade': 5, 'minPercent': 0, 'maxPercent': 39}
                ]
            }

        print(f"Found {len(user_data.get('classes', []))} classes for user {user_id}")
        print(f"Found {len(user_data.get('categories', []))} categories for user {user_id}")

        print(f"Successfully loaded data for user {user_id}")
        return jsonify(user_data)

    except Exception as e:
        print(f"Error loading data for user {user_id}: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/data', methods=['POST'])
@rate_limit('data_write')
@login_required
async def api_save_data():
    """Save all data for the current user (full sync)"""
    user_id = request.user['id'] # type: ignore
    token = get_token_from_request()
    encryption_key = get_encryption_key_for_session(token)
    data = await request.get_json()

    if not data:
        return jsonify({'success': False, 'message': 'backend.invalidRequest'}), 400

    # SECURITY: Require encryption key to save data
    if not encryption_key:
        print(f"Warning: No encryption key for user {user_id} - rejecting save request")
        return jsonify({
            'success': False,
            'message': 'backend.sessionExpired',
            'requireRelogin': True
        }), 401

    try:
        # Debug: Log the received data
        print(f"Received data for user {user_id}")
        print(f"Data preview: {len(data.get('classes', []))} classes, {len(data.get('categories', []))} categories")

        # Save complete user data to JSON database (encrypted) and update cache
        save_user_data(user_id, data, encryption_key, token)

        # Update any active share snapshots for this user
        update_active_shares_for_user(user_id, data)

        # Refresh org roster (name + class only) if this user is an approved org member
        sync_org_roster_for_user(user_id, data)

        print(f"Data successfully saved (encrypted) for user {user_id}")
        return jsonify({'success': True, 'message': 'backend.dataSaved'})

    except Exception as e:
        print(f"Error saving data for user {user_id}: {str(e)}")
        return jsonify({'success': False, 'message': 'backend.error'}), 500


DEFAULT_META = {
    'teacherName': '',
    'currentClassId': None,
    'categories': [],
    'students': [],
    'participationSettings': {'plusValue': 0.5, 'minusValue': 0.5},
    'plusMinusGradeSettings': {'startGrade': 3, 'plusValue': 0.5, 'minusValue': 0.5},
    'tutorial': {'completed': False, 'neverShowAgain': False},
    'gradePercentageRanges': [
        {'grade': 1, 'minPercent': 85, 'maxPercent': 100},
        {'grade': 2, 'minPercent': 70, 'maxPercent': 84},
        {'grade': 3, 'minPercent': 55, 'maxPercent': 69},
        {'grade': 4, 'minPercent': 40, 'maxPercent': 54},
        {'grade': 5, 'minPercent': 0, 'maxPercent': 39}
    ],
    'classOrder': []
}


@app.route('/api/data/meta', methods=['GET'])
@rate_limit('data_read')
@login_required
async def api_get_meta():
    """Return meta block (settings + classOrder) without per-class blobs."""
    user_id = request.user['id']  # type: ignore
    token = get_token_from_request()
    encryption_key = get_encryption_key_for_session(token)
    if not encryption_key:
        return jsonify({
            'success': False,
            'message': 'backend.sessionExpired',
            'requireRelogin': True
        }), 401
    try:
        meta = get_user_meta(user_id, encryption_key)
        if not meta:
            meta = dict(DEFAULT_META)
            save_user_meta(user_id, meta, encryption_key)
        return jsonify(meta)
    except Exception as e:
        logger.error("Error loading meta for user %s: %s", user_id, type(e).__name__)
        return jsonify({'error': 'load_failed'}), 500


@app.route('/api/data/meta', methods=['POST'])
@rate_limit('data_write')
@login_required
async def api_save_meta():
    """Save the meta block. Per-class blobs are unaffected."""
    user_id = request.user['id']  # type: ignore
    token = get_token_from_request()
    encryption_key = get_encryption_key_for_session(token)
    if not encryption_key:
        return jsonify({
            'success': False,
            'message': 'backend.sessionExpired',
            'requireRelogin': True
        }), 401
    payload = await request.get_json()
    if not isinstance(payload, dict):
        return jsonify({'success': False, 'message': 'backend.invalidRequest'}), 400
    try:
        save_user_meta(user_id, payload, encryption_key)
        # Active shares depend on class names which may change in meta — refresh,
        # but only if this user actually has shares (avoid full decrypt otherwise).
        if user_has_active_share(user_id):
            full = get_user_data(user_id, encryption_key)
            update_active_shares_for_user(user_id, full)
        return jsonify({'success': True, 'message': 'backend.dataSaved'})
    except Exception as e:
        logger.error("Error saving meta for user %s: %s", user_id, type(e).__name__)
        return jsonify({'success': False, 'message': 'backend.error'}), 500


@app.route('/api/data/class/<class_id>', methods=['GET'])
@rate_limit('data_read')
@login_required
async def api_get_class(class_id):
    """Return a single decrypted class blob."""
    user_id = request.user['id']  # type: ignore
    token = get_token_from_request()
    encryption_key = get_encryption_key_for_session(token)
    if not encryption_key:
        return jsonify({
            'success': False,
            'message': 'backend.sessionExpired',
            'requireRelogin': True
        }), 401
    try:
        cls = get_user_class(user_id, class_id, encryption_key)
        if cls is None:
            return jsonify({'error': 'not_found'}), 404
        return jsonify(cls)
    except Exception as e:
        logger.error("Error loading class %s for user %s: %s", class_id, user_id, type(e).__name__)
        return jsonify({'error': 'load_failed'}), 500


@app.route('/api/data/class/<class_id>', methods=['POST'])
@rate_limit('data_write')
@login_required
async def api_save_class(class_id):
    """Save a single class blob. Other classes/meta are not touched."""
    user_id = request.user['id']  # type: ignore
    token = get_token_from_request()
    encryption_key = get_encryption_key_for_session(token)
    if not encryption_key:
        return jsonify({
            'success': False,
            'message': 'backend.sessionExpired',
            'requireRelogin': True
        }), 401
    payload = await request.get_json()
    if not isinstance(payload, dict):
        return jsonify({'success': False, 'message': 'backend.invalidRequest'}), 400
    body_id = payload.get('id')
    if body_id is not None and str(body_id) != str(class_id):
        return jsonify({'success': False, 'message': 'backend.invalidRequest'}), 400
    payload['id'] = body_id if body_id is not None else class_id
    try:
        save_user_class(user_id, class_id, payload, encryption_key)
        # Refresh share snapshot only if there's an active share for THIS class.
        if user_has_active_share(user_id, class_id):
            full = get_user_data(user_id, encryption_key)
            update_active_shares_for_user(user_id, full)
        # Refresh org roster for this class if the user is an approved org member.
        if db_layer.get_org_membership(user_id):
            meta = get_user_meta(user_id, encryption_key)
            sync_org_roster_for_class(user_id, class_id, payload, meta.get('teacherName', ''))
        return jsonify({'success': True, 'message': 'backend.dataSaved'})
    except Exception as e:
        logger.error("Error saving class %s for user %s: %s", class_id, user_id, type(e).__name__)
        return jsonify({'success': False, 'message': 'backend.error'}), 500


@app.route('/api/data/class/<class_id>', methods=['DELETE'])
@rate_limit('data_write')
@login_required
async def api_delete_class(class_id):
    """Delete a single class blob and remove it from classOrder."""
    user_id = request.user['id']  # type: ignore
    token = get_token_from_request()
    encryption_key = get_encryption_key_for_session(token)
    if not encryption_key:
        return jsonify({
            'success': False,
            'message': 'backend.sessionExpired',
            'requireRelogin': True
        }), 401
    try:
        existed = delete_user_class(user_id, class_id)
        meta = get_user_meta(user_id, encryption_key)
        order = meta.get('classOrder') or []
        cid = str(class_id)
        if cid in order:
            meta['classOrder'] = [c for c in order if c != cid]
            if meta.get('currentClassId') == class_id or str(meta.get('currentClassId')) == cid:
                meta['currentClassId'] = None
            save_user_meta(user_id, meta, encryption_key)
        membership = db_layer.get_org_membership(user_id)
        if membership:
            db_layer.delete_roster_for_class(membership['org_id'], user_id, class_id)
        return jsonify({'success': existed})
    except Exception as e:
        logger.error("Error deleting class %s for user %s: %s", class_id, user_id, type(e).__name__)
        return jsonify({'success': False, 'message': 'backend.error'}), 500


@app.route('/api/heartbeat', methods=['POST'])
@login_required
async def api_heartbeat():
    """Heartbeat endpoint to keep session cache alive"""
    token = get_token_from_request()

    if token in user_data_cache:
        user_data_cache[token]["last_heartbeat"] = datetime.now()
        return jsonify({'success': True, 'cached': True})

    return jsonify({'success': True, 'cached': False})


@app.route('/api/disconnect', methods=['POST'])
@login_required
async def api_disconnect():
    """Called when user closes the page - clears cache but keeps session valid"""
    token = get_token_from_request()
    user_id = request.user['id'] # type: ignore

    # Clear only the data cache, keep the session and encryption key
    if token in user_data_cache:
        print(f"Clearing cache for user {user_id} (page closed)")
        del user_data_cache[token]

    return jsonify({'success': True})


# ============ Student Access (Share) API ============

@app.route('/api/share/class', methods=['POST'])
@rate_limit('share_manage')
@login_required
async def api_create_share():
    """Create a new share for a class with PINs for each student"""
    user_id = request.user['id']  # type: ignore
    token = get_token_from_request()
    encryption_key = get_encryption_key_for_session(token)
    data = await request.get_json()

    if not data:
        return jsonify({'success': False, 'message': 'backend.invalidRequest'}), 400

    class_id = data.get('class_id')
    if not class_id:
        return jsonify({'success': False, 'message': 'backend.invalidRequest'}), 400

    expires_hours = int(data.get('expires_hours', 168))  # Default 7 days
    visibility = data.get('visibility', {
        'grades': True, 'average': True, 'finalGrade': True,
        'categoryBreakdown': False, 'chart': False
    })

    # Load user data to build snapshot
    user_data = get_user_data_cached(user_id, token, encryption_key)
    if not user_data:
        return jsonify({'success': False, 'message': 'backend.error'}), 500

    # Find the class
    cls = None
    for c in user_data.get('classes', []):
        if c.get('id') == class_id:
            cls = c
            break
    if not cls:
        return jsonify({'success': False, 'message': 'backend.classNotFound'}), 404

    # Check if a share already exists for this class
    for _, existing_share in db_layer.iter_shares():
        if existing_share.get('user_id') == user_id and existing_share.get('class_id') == class_id and existing_share.get('active'):
            return jsonify({'success': False, 'message': 'backend.shareExists'}), 409

    # Generate share token
    share_token = generate_share_token()

    # Get the current year from the class to access students
    current_year_id = cls.get('currentYearId')
    current_year = None
    if current_year_id and cls.get('years'):
        for year in cls.get('years', []):
            if year.get('id') == current_year_id:
                current_year = year
                break
    
    # Get students from the current year if available, otherwise from class (fallback for backward compatibility)
    students = current_year.get('students', []) if current_year else cls.get('students', [])

    # Generate PINs for each student
    existing_pins = set()
    students_pins = {}  # student_id -> {pin_hash, name, pin (cleartext for response only)}
    cleartext_pins = {}  # student_id -> pin (returned to teacher once)

    for student in students:
        pin = generate_unique_pin(existing_pins)
        existing_pins.add(pin)
        students_pins[student['id']] = {
            'pin_hash': hash_pin(pin),
            'name': get_student_display_name(student)
        }
        cleartext_pins[student['id']] = pin

    # Build snapshot
    snapshot = build_share_snapshot(user_data, class_id)
    if not snapshot:
        return jsonify({'success': False, 'message': 'backend.error'}), 500

    # Get teacher name
    teacher_name = user_data.get('teacherName', '') or request.user.get('username', '')  # type: ignore

    # Encrypt the snapshot data before storing
    encrypted_snapshot = encrypt_share_data(snapshot, MASTER_SHARE_KEY)

    # Store share
    now = datetime.now()
    share_data = {
        'user_id': user_id,
        'class_id': class_id,
        'class_name': cls.get('name', ''),
        'teacher_name': teacher_name,
        'created_at': now.isoformat(),
        'expires_at': (now + timedelta(hours=expires_hours)).isoformat(),
        'active': True,
        'visibility': visibility,
        'students': students_pins,
        'encrypted_data': encrypted_snapshot  # Store encrypted data
    }

    db_layer.put_share(share_token, share_data)

    # Return share info with cleartext PINs (shown once to teacher)
    pin_list = []
    for student in students:  # Use the 'students' variable defined earlier in the function
        pin_list.append({
            'student_id': student['id'],
            'name': get_student_display_name(student),
            'pin': cleartext_pins.get(student['id'], '')
        })

    return jsonify({
        'success': True,
        'token': share_token,
        'expires_at': share_data['expires_at'],
        'pins': pin_list
    })


@app.route('/api/share/class/<share_token>', methods=['PUT'])
@rate_limit('share_manage')
@login_required
async def api_update_share(share_token):
    """Update visibility or expiration of an existing share"""
    user_id = request.user['id']  # type: ignore
    data = await request.get_json()

    if not data:
        return jsonify({'success': False, 'message': 'backend.invalidRequest'}), 400

    share = db_layer.get_share(share_token)

    if not share or share.get('user_id') != user_id:
        return jsonify({'success': False, 'message': 'backend.shareNotFound'}), 404

    # Update visibility
    if 'visibility' in data:
        share['visibility'] = data['visibility']

    # Update expiration
    if 'expires_hours' in data:
        expires_hours = int(data['expires_hours'])
        share['expires_at'] = (datetime.now() + timedelta(hours=expires_hours)).isoformat()
        share['active'] = True  # Re-activate if was expired

    db_layer.put_share(share_token, share)
    return jsonify({'success': True, 'message': 'backend.shareUpdated'})


@app.route('/api/share/class/<share_token>', methods=['DELETE'])
@rate_limit('share_manage')
@login_required
async def api_revoke_share(share_token):
    """Revoke (delete) a share"""
    user_id = request.user['id']  # type: ignore

    share = db_layer.get_share(share_token)

    if not share or share.get('user_id') != user_id:
        return jsonify({'success': False, 'message': 'backend.shareNotFound'}), 404

    db_layer.delete_share(share_token)
    return jsonify({'success': True, 'message': 'backend.shareRevoked'})


@app.route('/api/share/class/<share_token>/regenerate-pins', methods=['POST'])
@rate_limit('share_manage')
@login_required
async def api_regenerate_pins(share_token):
    """Regenerate all PINs for a share"""
    user_id = request.user['id']  # type: ignore

    share = db_layer.get_share(share_token)

    if not share or share.get('user_id') != user_id:
        return jsonify({'success': False, 'message': 'backend.shareNotFound'}), 404

    if not share.get('active'):
        return jsonify({'success': False, 'message': 'backend.shareNotActive'}), 400

    # Regenerate PINs
    existing_pins = set()
    cleartext_pins = {}
    pin_list = []

    for student_id, student_info in share.get('students', {}).items():
        pin = generate_unique_pin(existing_pins)
        existing_pins.add(pin)
        student_info['pin_hash'] = hash_pin(pin)
        cleartext_pins[student_id] = pin
        pin_list.append({
            'student_id': student_id,
            'name': get_student_display_name(student_info),
            'pin': pin
        })

    db_layer.put_share(share_token, share)
    return jsonify({'success': True, 'pins': pin_list})


@app.route('/api/share/class/status/<class_id>', methods=['GET'])
@rate_limit('share_manage')
@login_required
async def api_get_share_status(class_id):
    """Get the share status for a class"""
    user_id = request.user['id']  # type: ignore

    for token, share in db_layer.iter_shares():
        if share.get('user_id') == user_id and share.get('class_id') == class_id:
            if share.get('active'):
                expires_at = share.get('expires_at')
                if expires_at and datetime.fromisoformat(expires_at) < datetime.now():
                    db_layer.delete_share(token)
                    return jsonify({'success': True, 'has_share': False})

                return jsonify({
                    'success': True,
                    'has_share': True,
                    'token': token,
                    'class_name': share.get('class_name', ''),
                    'created_at': share.get('created_at', ''),
                    'expires_at': share.get('expires_at', ''),
                    'visibility': share.get('visibility', {}),
                    'student_count': len(share.get('students', {}))
                })

    return jsonify({'success': True, 'has_share': False})


# ============ Organisation API ============
#
# Orgs group teachers under an admin. Two deliberate, narrow exceptions to the
# zero-knowledge model live here (see plan discussion): org_roster stores
# student name + class only (no grades), and class handovers use the same
# MASTER_SHARE_KEY server-decryptable pattern as class_shares.

def _create_org_record(name: str, admin_user_id: str) -> dict:
    """Create an org and make admin_user_id its approved admin.
    Used only by the org-admin registration flow (see register_org_admin) —
    org creation is not reachable from inside the app for existing accounts."""
    import uuid
    org_id = str(uuid.uuid4())[:8]
    attempts = 0
    while db_layer.get_org(org_id) is not None and attempts < 100:
        org_id = str(uuid.uuid4())[:8]
        attempts += 1

    join_code = generate_org_join_code()
    attempts = 0
    while db_layer.get_org_by_join_code(join_code) is not None and attempts < 100:
        join_code = generate_org_join_code()
        attempts += 1

    now = datetime.now().isoformat()
    db_layer.create_org(org_id, name, join_code, admin_user_id, now)
    db_layer.put_org_member(org_id, admin_user_id, 'admin', 'approved', now, now)

    return {'id': org_id, 'name': name, 'join_code': join_code, 'role': 'admin', 'status': 'approved'}


def register_org_admin(org_name: str, username: str, email: str, password: str) -> dict:
    """Register a pure org-admin account (no personal gradebook) and create its org."""
    org_name = org_name.strip()
    if not org_name or len(org_name) > 100:
        return {'success': False, 'message': 'backend.orgInvalidName', 'user_id': None}

    result = register_user(username, email, password, account_type='org_admin')
    if not result.get('success'):
        return result

    org = _create_org_record(org_name, result['user_id'])
    result['org'] = org
    return result


@app.route('/api/org/join', methods=['POST'])
@rate_limit('org_join')
@login_required
async def api_join_org():
    """Request to join an org via its join code (admin approval required)."""
    user_id = request.user['id']  # type: ignore
    if db_layer.get_org_membership(user_id):
        return jsonify({'success': False, 'message': 'backend.orgAlreadyMember'}), 409

    data = await request.get_json()
    join_code = ((data or {}).get('join_code') or '').strip().upper()
    if not join_code:
        return jsonify({'success': False, 'message': 'backend.invalidRequest'}), 400

    org = db_layer.get_org_by_join_code(join_code)
    if not org:
        return jsonify({'success': False, 'message': 'backend.orgCodeInvalid'}), 404

    now = datetime.now().isoformat()
    db_layer.put_org_member(org['id'], user_id, 'teacher', 'pending', now, None)

    if smtp_is_configured():
        admin = db_layer.get_user_by_id(org['admin_user_id'])
        requester = db_layer.get_user_by_id(user_id)
        if admin and requester:
            try:
                await send_org_join_request_email(
                    admin['email'], admin.get('username', admin['email']), org['name'],
                    requester.get('username', requester['email']), requester['email']
                )
            except Exception as e:
                logger.warning("Failed to send org join notification: %s", type(e).__name__)

    return jsonify({'success': True, 'message': 'backend.orgJoinRequested'})


@app.route('/api/org/status', methods=['GET'])
@login_required
async def api_org_status():
    """Return the current user's org membership (or none)."""
    user_id = request.user['id']  # type: ignore
    membership = db_layer.get_org_membership(user_id)
    if not membership:
        return jsonify({'success': True, 'member': False})

    org = db_layer.get_org(membership['org_id'])
    if not org:
        return jsonify({'success': True, 'member': False})

    return jsonify({
        'success': True,
        'member': True,
        'role': membership['role'],
        'status': membership['status'],
        'org': {
            'id': org['id'],
            'name': org['name'],
            'join_code': org['join_code'] if membership['role'] == 'admin' else None
        }
    })


@app.route('/api/org/pending', methods=['GET'])
@rate_limit('org_manage')
@login_required
@org_admin_required
async def api_org_pending():
    """List teachers awaiting approval into the admin's org."""
    rows = db_layer.list_pending_members(request.org_id)  # type: ignore
    result = []
    for row in rows:
        u = db_layer.get_user_by_id(row['user_id'])
        if not u:
            continue
        result.append({
            'user_id': row['user_id'],
            'username': u.get('username', ''),
            'email': u.get('email', ''),
            'requested_at': row['requested_at']
        })
    return jsonify({'success': True, 'pending': result})


@app.route('/api/org/members/<member_user_id>/approve', methods=['POST'])
@rate_limit('org_manage')
@login_required
@org_admin_required
async def api_org_approve_member(member_user_id):
    """Approve a pending member of the admin's org."""
    org_id = request.org_id  # type: ignore
    membership = db_layer.get_org_membership(member_user_id)
    if not membership or membership['org_id'] != org_id or membership['status'] != 'pending':
        return jsonify({'success': False, 'message': 'backend.orgMemberNotFound'}), 404

    now = datetime.now().isoformat()
    db_layer.approve_member(org_id, member_user_id, now)

    if smtp_is_configured():
        org = db_layer.get_org(org_id)
        u = db_layer.get_user_by_id(member_user_id)
        if org and u:
            try:
                await send_org_approved_email(u['email'], u.get('username', u['email']), org['name'])
            except Exception as e:
                logger.warning("Failed to send org approval notification: %s", type(e).__name__)

    return jsonify({'success': True, 'message': 'backend.orgMemberApproved'})


@app.route('/api/org/members/<member_user_id>/reject', methods=['POST'])
@rate_limit('org_manage')
@login_required
@org_admin_required
async def api_org_reject_member(member_user_id):
    """Reject a pending member (or remove an approved one) from the admin's org."""
    org_id = request.org_id  # type: ignore
    membership = db_layer.get_org_membership(member_user_id)
    if not membership or membership['org_id'] != org_id:
        return jsonify({'success': False, 'message': 'backend.orgMemberNotFound'}), 404

    db_layer.remove_member(org_id, member_user_id)
    db_layer.delete_roster_for_user(org_id, member_user_id)
    return jsonify({'success': True, 'message': 'backend.orgMemberRejected'})


@app.route('/api/org/leave', methods=['POST'])
@rate_limit('org_manage')
@login_required
@org_member_required
async def api_org_leave():
    """Leave the current org. An admin can only leave if no other members remain."""
    user_id = request.user['id']  # type: ignore
    org_id = request.org_id  # type: ignore
    role = request.org_role  # type: ignore

    if role == 'admin' and len(db_layer.list_org_members(org_id)) > 1:
        return jsonify({'success': False, 'message': 'backend.orgAdminCannotLeave'}), 400

    db_layer.remove_member(org_id, user_id)
    db_layer.delete_roster_for_user(org_id, user_id)
    if role == 'admin':
        db_layer.delete_org(org_id)

    return jsonify({'success': True, 'message': 'backend.orgLeft'})


@app.route('/api/org/members/search', methods=['GET'])
@rate_limit('org_manage')
@login_required
@org_member_required
async def api_org_members_search():
    """Prefix-search approved org members by email, for the handover picker."""
    q = (request.args.get('q') or '').strip().lower()
    if len(q) < 2:
        return jsonify({'success': True, 'results': []})

    user_id = request.user['id']  # type: ignore
    org_id = request.org_id  # type: ignore
    results = []
    for m in db_layer.list_org_members(org_id):
        if m['user_id'] == user_id:
            continue
        u = db_layer.get_user_by_id(m['user_id'])
        if not u or q not in u.get('email', '').lower():
            continue
        results.append({'user_id': u['id'], 'email': u['email'], 'username': u.get('username', '')})
        if len(results) >= 10:
            break

    return jsonify({'success': True, 'results': results})


@app.route('/api/org/roster', methods=['GET'])
@rate_limit('data_read')
@login_required
@org_member_required
async def api_org_roster():
    """Return the org-wide roster: student name + class + teacher (no grades)."""
    rows = db_layer.list_roster(request.org_id)  # type: ignore
    return jsonify({'success': True, 'roster': rows})


@app.route('/api/org/handover', methods=['POST'])
@rate_limit('org_manage')
@login_required
@org_member_required
async def api_create_handover():
    """Offer a class to another org teacher, with granular include flags."""
    user_id = request.user['id']  # type: ignore
    org_id = request.org_id  # type: ignore
    session_token = get_token_from_request()
    encryption_key = get_encryption_key_for_session(session_token)
    if not encryption_key:
        return jsonify({'success': False, 'message': 'backend.sessionExpired', 'requireRelogin': True}), 401

    data = await request.get_json()
    if not data:
        return jsonify({'success': False, 'message': 'backend.invalidRequest'}), 400

    class_id = data.get('class_id')
    to_user_id = data.get('to_user_id')
    include = data.get('include') or {}
    if not class_id or not to_user_id or to_user_id == user_id:
        return jsonify({'success': False, 'message': 'backend.invalidRequest'}), 400

    target_membership = db_layer.get_org_membership(to_user_id)
    if not target_membership or target_membership['org_id'] != org_id or target_membership['status'] != 'approved':
        return jsonify({'success': False, 'message': 'backend.orgMemberNotFound'}), 404

    cls = get_user_class(user_id, class_id, encryption_key)
    if cls is None:
        return jsonify({'success': False, 'message': 'backend.classNotFound'}), 404

    meta = get_user_meta(user_id, encryption_key)
    snapshot = build_handover_snapshot(cls, meta.get('categories', []), include)
    encrypted_snapshot = encrypt_share_data(snapshot, MASTER_SHARE_KEY)

    handover_token = generate_share_token()
    now = datetime.now()
    to_user = db_layer.get_user_by_id(to_user_id)
    handover_data = {
        'org_id': org_id,
        'from_user_id': user_id,
        'from_username': request.user.get('username', ''),  # type: ignore
        'to_user_id': to_user_id,
        'class_id': class_id,
        'class_name': cls.get('name', ''),
        'status': 'pending',
        'include': include,
        'encrypted_data': encrypted_snapshot,
        'created_at': now.isoformat(),
        'expires_at': (now + timedelta(days=7)).isoformat(),
    }
    db_layer.put_handover(handover_token, handover_data)

    if smtp_is_configured() and to_user:
        try:
            await send_org_handover_email(
                to_user['email'], to_user.get('username', to_user['email']),
                request.user.get('username', ''), cls.get('name', '')  # type: ignore
            )
        except Exception as e:
            logger.warning("Failed to send handover notification: %s", type(e).__name__)

    return jsonify({'success': True, 'token': handover_token})


@app.route('/api/org/handovers', methods=['GET'])
@login_required
@org_member_required
async def api_list_handovers():
    """List pending class handovers addressed to the current user."""
    user_id = request.user['id']  # type: ignore
    now = datetime.now()
    result = []
    for token, h in db_layer.list_handovers_for_user(user_id, 'pending'):
        expires_at = h.get('expires_at')
        if expires_at and datetime.fromisoformat(expires_at) < now:
            continue
        result.append({
            'token': token,
            'class_name': h.get('class_name', ''),
            'from_username': h.get('from_username', ''),
            'include': h.get('include', {}),
            'created_at': h.get('created_at', ''),
            'expires_at': expires_at,
        })
    return jsonify({'success': True, 'handovers': result})


@app.route('/api/org/handover/<handover_token>/accept', methods=['POST'])
@rate_limit('org_manage')
@login_required
@org_member_required
async def api_accept_handover(handover_token):
    """Accept a pending handover: import the class, then delete it from the sender."""
    user_id = request.user['id']  # type: ignore
    session_token = get_token_from_request()
    encryption_key = get_encryption_key_for_session(session_token)
    if not encryption_key:
        return jsonify({'success': False, 'message': 'backend.sessionExpired', 'requireRelogin': True}), 401

    handover = db_layer.get_handover(handover_token)
    if not handover or handover.get('to_user_id') != user_id:
        return jsonify({'success': False, 'message': 'backend.handoverNotFound'}), 404
    if handover.get('status') != 'pending':
        return jsonify({'success': False, 'message': 'backend.handoverNotPending'}), 400

    expires_at = handover.get('expires_at')
    if expires_at and datetime.fromisoformat(expires_at) < datetime.now():
        handover['status'] = 'expired'
        db_layer.put_handover(handover_token, handover)
        return jsonify({'success': False, 'message': 'backend.handoverExpired'}), 400

    snapshot = decrypt_share_data(handover.get('encrypted_data', ''), MASTER_SHARE_KEY)
    new_class = snapshot.get('class')
    if not new_class:
        return jsonify({'success': False, 'message': 'backend.error'}), 500

    import uuid
    new_class_id = str(uuid.uuid4())[:8]
    new_class['id'] = new_class_id
    save_user_class(user_id, new_class_id, new_class, encryption_key)

    # Append to recipient's classOrder and merge any category definitions
    # referenced by the transferred grades that the recipient doesn't have yet.
    meta = get_user_meta(user_id, encryption_key)
    order = meta.get('classOrder') or []
    order.append(new_class_id)
    meta['classOrder'] = order
    existing_cat_ids = {c.get('id') for c in meta.get('categories', [])}
    for cat in snapshot.get('categories', []):
        if cat.get('id') not in existing_cat_ids:
            meta.setdefault('categories', []).append(cat)
            existing_cat_ids.add(cat.get('id'))
    save_user_meta(user_id, meta, encryption_key)

    # Remove the class from the sender's account (server holds no key for the
    # sender's meta, so their classOrder may keep a dangling id — already
    # tolerated elsewhere, see _assemble_blob_from_v2).
    from_user_id = handover.get('from_user_id')
    class_id = handover.get('class_id')
    delete_user_class(from_user_id, class_id)
    org_id = handover.get('org_id')
    if org_id:
        db_layer.delete_roster_for_class(org_id, from_user_id, class_id)

    handover['status'] = 'accepted'
    db_layer.put_handover(handover_token, handover)

    sync_org_roster_for_class(user_id, new_class_id, new_class, meta.get('teacherName', ''))

    return jsonify({'success': True, 'class_id': new_class_id})


@app.route('/api/org/handover/<handover_token>/decline', methods=['POST'])
@rate_limit('org_manage')
@login_required
@org_member_required
async def api_decline_handover(handover_token):
    """Decline a pending handover; the class stays with the sender."""
    user_id = request.user['id']  # type: ignore
    handover = db_layer.get_handover(handover_token)
    if not handover or handover.get('to_user_id') != user_id:
        return jsonify({'success': False, 'message': 'backend.handoverNotFound'}), 404
    if handover.get('status') != 'pending':
        return jsonify({'success': False, 'message': 'backend.handoverNotPending'}), 400

    handover['status'] = 'declined'
    db_layer.put_handover(handover_token, handover)
    return jsonify({'success': True, 'message': 'backend.handoverDeclined'})


# ============ WebUntis API ============
#
# Each teacher connects their own WebUntis account. Credentials are stored
# inside the user's existing encrypted meta blob (get_user_meta/save_user_meta,
# same AES-GCM-under-session-DEK scheme as teacherName/categories/etc.) — NOT
# under MASTER_SHARE_KEY, so this stays true zero-knowledge: the server can
# only read them while the teacher has an active, unlocked session, exactly
# like every other piece of user data.

def _webuntis_error_response(e: Exception):
    """Map a webuntis_client exception to a (jsonify, status) tuple."""
    if isinstance(e, webuntis_client.WebUntisAuthError):
        return jsonify({'success': False, 'message': 'backend.webUntisAuthFailed'}), 401
    if isinstance(e, webuntis_client.WebUntisConnectionError):
        return jsonify({'success': False, 'message': 'backend.webUntisConnectionFailed'}), 502
    return jsonify({'success': False, 'message': 'backend.webUntisError'}), 502


@app.route('/api/webuntis/connect', methods=['POST'])
@rate_limit('webuntis_connect')
@login_required
async def api_webuntis_connect():
    """Verify a WebUntis TOTP secret and store it (encrypted) for this teacher.

    Accepts either a pasted QR-code link (``{"qr": "untis://setschool?..."}``)
    or the four fields directly (``{server, school, username, secret}``) —
    the QR link is the primary/recommended path (see webuntis.js), the
    manual fields are a fallback for schools where that isn't available.
    Never a password: see webuntis_client.py's module docstring for why.
    """
    user_id = request.user['id']  # type: ignore
    token = get_token_from_request()
    encryption_key = get_encryption_key_for_session(token)
    if not encryption_key:
        return jsonify({'success': False, 'message': 'backend.sessionExpired', 'requireRelogin': True}), 401

    data = await request.get_json() or {}
    qr = (data.get('qr') or '').strip()
    if qr:
        try:
            fields = webuntis_client.parse_qr_code(qr)
        except ValueError:
            return jsonify({'success': False, 'message': 'backend.webUntisInvalidQr'}), 400
        server, school, username, secret = fields['server'], fields['school'], fields['username'], fields['secret']
    else:
        server = (data.get('server') or '').strip()
        school = (data.get('school') or '').strip()
        username = (data.get('username') or '').strip()
        secret = (data.get('secret') or '').strip()
    if not server or not school or not username or not secret:
        return jsonify({'success': False, 'message': 'backend.invalidRequest'}), 400

    client = webuntis_client.WebUntisClient(server, school)
    try:
        await client.login(username, secret)
    except webuntis_client.WebUntisError as e:
        return _webuntis_error_response(e)
    finally:
        await client.close()

    meta = get_user_meta(user_id, encryption_key)
    meta['webUntis'] = {'server': server, 'school': school, 'username': username, 'secret': secret}
    save_user_meta(user_id, meta, encryption_key)
    return jsonify({'success': True, 'message': 'backend.webUntisConnected'})


@app.route('/api/webuntis/connect', methods=['DELETE'])
@rate_limit('org_manage')
@login_required
async def api_webuntis_disconnect():
    """Remove stored WebUntis credentials for this teacher."""
    user_id = request.user['id']  # type: ignore
    token = get_token_from_request()
    encryption_key = get_encryption_key_for_session(token)
    if not encryption_key:
        return jsonify({'success': False, 'message': 'backend.sessionExpired', 'requireRelogin': True}), 401

    meta = get_user_meta(user_id, encryption_key)
    meta.pop('webUntis', None)
    save_user_meta(user_id, meta, encryption_key)
    return jsonify({'success': True, 'message': 'backend.webUntisDisconnected'})


@app.route('/api/webuntis/status', methods=['GET'])
@rate_limit('data_read')
@login_required
async def api_webuntis_status():
    """Whether this teacher has WebUntis connected (never returns the secret)."""
    user_id = request.user['id']  # type: ignore
    token = get_token_from_request()
    encryption_key = get_encryption_key_for_session(token)
    if not encryption_key:
        return jsonify({'success': False, 'message': 'backend.sessionExpired', 'requireRelogin': True}), 401

    meta = get_user_meta(user_id, encryption_key)
    wu = meta.get('webUntis')
    if not wu:
        return jsonify({'success': True, 'connected': False})
    return jsonify({
        'success': True,
        'connected': True,
        'server': wu.get('server', ''),
        'school': wu.get('school', ''),
        'username': wu.get('username', '')
    })


async def _get_webuntis_creds(user_id: str, encryption_key: bytes) -> dict | None:
    meta = get_user_meta(user_id, encryption_key)
    return meta.get('webUntis')


@app.route('/api/webuntis/klassen', methods=['GET'])
@rate_limit('data_read')
@login_required
async def api_webuntis_klassen():
    """List classes visible to the connected WebUntis account, for import."""
    user_id = request.user['id']  # type: ignore
    token = get_token_from_request()
    encryption_key = get_encryption_key_for_session(token)
    if not encryption_key:
        return jsonify({'success': False, 'message': 'backend.sessionExpired', 'requireRelogin': True}), 401

    wu = await _get_webuntis_creds(user_id, encryption_key)
    if not wu:
        return jsonify({'success': False, 'message': 'backend.webUntisNotConnected'}), 400

    client = webuntis_client.WebUntisClient(wu['server'], wu['school'])
    try:
        await client.login(wu['username'], wu['secret'])
        klassen = await client.get_klassen()
    except webuntis_client.WebUntisError as e:
        return _webuntis_error_response(e)
    finally:
        await client.close()

    return jsonify({'success': True, 'klassen': klassen})


@app.route('/api/webuntis/klassen/<klasse_id>/import', methods=['POST'])
@rate_limit('data_write')
@login_required
async def api_webuntis_import_klasse(klasse_id):
    """Fetch a WebUntis class's roster for the frontend to build a new class from.

    Returns raw {name, students} only — the frontend builds the actual class
    object via the same addClass()/addStudent() shape as manual creation and
    saves it through the normal /api/data/class/<id> path, so this endpoint
    doesn't need to duplicate the default-subjects/year-template logic.
    """
    user_id = request.user['id']  # type: ignore
    token = get_token_from_request()
    encryption_key = get_encryption_key_for_session(token)
    if not encryption_key:
        return jsonify({'success': False, 'message': 'backend.sessionExpired', 'requireRelogin': True}), 401

    data = await request.get_json()
    class_name = ((data or {}).get('name') or '').strip()
    if not class_name:
        return jsonify({'success': False, 'message': 'backend.invalidRequest'}), 400

    wu = await _get_webuntis_creds(user_id, encryption_key)
    if not wu:
        return jsonify({'success': False, 'message': 'backend.webUntisNotConnected'}), 400

    try:
        klasse_id_int = int(klasse_id)
    except ValueError:
        return jsonify({'success': False, 'message': 'backend.invalidRequest'}), 400

    client = webuntis_client.WebUntisClient(wu['server'], wu['school'])
    try:
        await client.login(wu['username'], wu['secret'])
        students, filtered = await client.get_students(klasse_id_int)
    except webuntis_client.WebUntisError as e:
        return _webuntis_error_response(e)
    finally:
        await client.close()

    result = {'success': True, 'name': class_name, 'students': students}
    if not filtered:
        result['warning'] = 'backend.webUntisRosterUnfiltered'
    return jsonify(result)


@app.route('/api/webuntis/timetable', methods=['GET'])
@rate_limit('data_read')
@login_required
async def api_webuntis_timetable():
    """Read-only weekly timetable for the connected WebUntis account."""
    user_id = request.user['id']  # type: ignore
    token = get_token_from_request()
    encryption_key = get_encryption_key_for_session(token)
    if not encryption_key:
        return jsonify({'success': False, 'message': 'backend.sessionExpired', 'requireRelogin': True}), 401

    wu = await _get_webuntis_creds(user_id, encryption_key)
    if not wu:
        return jsonify({'success': False, 'message': 'backend.webUntisNotConnected'}), 400

    start = (request.args.get('start') or '').strip()
    end = (request.args.get('end') or '').strip()
    if not (start.isdigit() and len(start) == 8 and end.isdigit() and len(end) == 8):
        # Default to the current week (Mon-Sun) when not specified.
        today = datetime.now()
        monday = today - timedelta(days=today.weekday())
        sunday = monday + timedelta(days=6)
        start = monday.strftime('%Y%m%d')
        end = sunday.strftime('%Y%m%d')

    client = webuntis_client.WebUntisClient(wu['server'], wu['school'])
    try:
        await client.login(wu['username'], wu['secret'])
        periods = await client.get_timetable(start, end)
    except webuntis_client.WebUntisError as e:
        return _webuntis_error_response(e)
    finally:
        await client.close()

    return jsonify({'success': True, 'periods': periods})


# ============ Moodle API ============
#
# Auth is a per-teacher Moodle Web Service token (Moodle: Profile →
# Preferences → "Security keys") — never a password, same principle as the
# WebUntis integration above. Stored in the same encrypted user_meta blob,
# under its own 'moodle' key, plus a 'moodleClassMap' dict mapping EduGrade
# class id -> Moodle course id (kept out of the class blob itself so it
# can't conflict with concurrent grade/roster edits).

_MOODLE_REQUIRED_FUNCTIONS = {'core_enrol_get_users_courses', 'core_calendar_create_calendar_events'}


def _moodle_error_response(e: Exception):
    """Map a moodle_client exception to a (jsonify, status) tuple."""
    if isinstance(e, moodle_client.MoodleAuthError):
        return jsonify({'success': False, 'message': 'backend.moodleAuthFailed'}), 401
    if isinstance(e, moodle_client.MoodleConnectionError):
        return jsonify({'success': False, 'message': 'backend.moodleConnectionFailed'}), 502
    return jsonify({'success': False, 'message': 'backend.moodleError'}), 502


@app.route('/api/moodle/connect', methods=['POST'])
@rate_limit('moodle_connect')
@login_required
async def api_moodle_connect():
    """Verify a Moodle Web Service token and store it (encrypted) for this teacher."""
    user_id = request.user['id']  # type: ignore
    token = get_token_from_request()
    encryption_key = get_encryption_key_for_session(token)
    if not encryption_key:
        return jsonify({'success': False, 'message': 'backend.sessionExpired', 'requireRelogin': True}), 401

    data = await request.get_json() or {}
    url = (data.get('url') or '').strip()
    moodle_token = (data.get('token') or '').strip()
    if not url or not moodle_token:
        return jsonify({'success': False, 'message': 'backend.invalidRequest'}), 400

    client = moodle_client.MoodleClient(url, moodle_token)
    try:
        info = await client.get_site_info()
    except moodle_client.MoodleError as e:
        return _moodle_error_response(e)
    finally:
        await client.close()

    available = {f.get('name') for f in (info.get('functions') or [])}
    if not _MOODLE_REQUIRED_FUNCTIONS.issubset(available):
        return jsonify({'success': False, 'message': 'backend.moodleMissingFunctions'}), 400

    meta = get_user_meta(user_id, encryption_key)
    meta['moodle'] = {
        'url': url, 'token': moodle_token,
        'userid': info.get('userid'), 'fullname': info.get('fullname', ''),
    }
    save_user_meta(user_id, meta, encryption_key)
    return jsonify({'success': True, 'message': 'backend.moodleConnected'})


@app.route('/api/moodle/connect', methods=['DELETE'])
@rate_limit('org_manage')
@login_required
async def api_moodle_disconnect():
    """Remove stored Moodle credentials (and class mapping) for this teacher."""
    user_id = request.user['id']  # type: ignore
    token = get_token_from_request()
    encryption_key = get_encryption_key_for_session(token)
    if not encryption_key:
        return jsonify({'success': False, 'message': 'backend.sessionExpired', 'requireRelogin': True}), 401

    meta = get_user_meta(user_id, encryption_key)
    meta.pop('moodle', None)
    meta.pop('moodleClassMap', None)
    save_user_meta(user_id, meta, encryption_key)
    return jsonify({'success': True, 'message': 'backend.moodleDisconnected'})


@app.route('/api/moodle/status', methods=['GET'])
@rate_limit('data_read')
@login_required
async def api_moodle_status():
    """Whether this teacher has Moodle connected (never returns the token)."""
    user_id = request.user['id']  # type: ignore
    token = get_token_from_request()
    encryption_key = get_encryption_key_for_session(token)
    if not encryption_key:
        return jsonify({'success': False, 'message': 'backend.sessionExpired', 'requireRelogin': True}), 401

    meta = get_user_meta(user_id, encryption_key)
    mo = meta.get('moodle')
    if not mo:
        return jsonify({'success': True, 'connected': False})
    return jsonify({'success': True, 'connected': True, 'url': mo.get('url', ''), 'fullname': mo.get('fullname', '')})


async def _get_moodle_creds(user_id: str, encryption_key: bytes) -> dict | None:
    meta = get_user_meta(user_id, encryption_key)
    return meta.get('moodle')


@app.route('/api/moodle/courses', methods=['GET'])
@rate_limit('data_read')
@login_required
async def api_moodle_courses():
    """List Moodle courses the connected teacher is enrolled in, for class mapping."""
    user_id = request.user['id']  # type: ignore
    token = get_token_from_request()
    encryption_key = get_encryption_key_for_session(token)
    if not encryption_key:
        return jsonify({'success': False, 'message': 'backend.sessionExpired', 'requireRelogin': True}), 401

    mo = await _get_moodle_creds(user_id, encryption_key)
    if not mo:
        return jsonify({'success': False, 'message': 'backend.moodleNotConnected'}), 400

    client = moodle_client.MoodleClient(mo['url'], mo['token'])
    try:
        courses = await client.get_courses(mo['userid'])
    except moodle_client.MoodleError as e:
        return _moodle_error_response(e)
    finally:
        await client.close()

    return jsonify({'success': True, 'courses': courses})


@app.route('/api/moodle/classes/<class_id>/map', methods=['POST'])
@rate_limit('data_write')
@login_required
async def api_moodle_map_class(class_id):
    """Set (or clear, with courseId: null) which Moodle course an EduGrade class maps to."""
    user_id = request.user['id']  # type: ignore
    token = get_token_from_request()
    encryption_key = get_encryption_key_for_session(token)
    if not encryption_key:
        return jsonify({'success': False, 'message': 'backend.sessionExpired', 'requireRelogin': True}), 401

    data = await request.get_json() or {}
    course_id = data.get('courseId')

    meta = get_user_meta(user_id, encryption_key)
    class_map = meta.get('moodleClassMap') or {}
    if course_id is None:
        class_map.pop(str(class_id), None)
    else:
        class_map[str(class_id)] = course_id
    meta['moodleClassMap'] = class_map
    save_user_meta(user_id, meta, encryption_key)
    return jsonify({'success': True})


@app.route('/api/moodle/push-event', methods=['POST'])
@rate_limit('data_write')
@login_required
async def api_moodle_push_event():
    """Push one exam/test as a course-visible calendar event to the mapped Moodle course."""
    user_id = request.user['id']  # type: ignore
    token = get_token_from_request()
    encryption_key = get_encryption_key_for_session(token)
    if not encryption_key:
        return jsonify({'success': False, 'message': 'backend.sessionExpired', 'requireRelogin': True}), 401

    data = await request.get_json() or {}
    class_id = str(data.get('classId') or '')
    name = (data.get('name') or '').strip()
    timestart = data.get('timestart')
    timeduration = data.get('timeduration') or 0
    if not class_id or not name or not isinstance(timestart, int):
        return jsonify({'success': False, 'message': 'backend.invalidRequest'}), 400

    mo = await _get_moodle_creds(user_id, encryption_key)
    if not mo:
        return jsonify({'success': False, 'message': 'backend.moodleNotConnected'}), 400

    meta = get_user_meta(user_id, encryption_key)
    course_id = (meta.get('moodleClassMap') or {}).get(class_id)
    if not course_id:
        return jsonify({'success': False, 'message': 'backend.moodleNoCourseMapped'}), 404

    client = moodle_client.MoodleClient(mo['url'], mo['token'])
    try:
        await client.create_course_event(course_id, name, timestart, timeduration)
    except moodle_client.MoodleError as e:
        return _moodle_error_response(e)
    finally:
        await client.close()

    return jsonify({'success': True, 'message': 'backend.moodleEventCreated'})


# ============ Public Student Access ============

@app.route('/grades/<share_token>')
async def student_grades_page(share_token):
    """Student-facing page for viewing grades"""
    share = db_layer.get_share(share_token)

    error = None
    if not share:
        error = 'invalid'
    elif not share.get('active'):
        error = 'revoked'
    else:
        expires_at = share.get('expires_at')
        if expires_at and datetime.fromisoformat(expires_at) < datetime.now():
            error = 'expired'

    return await render_template('student_grades.html',
        token=share_token,
        error=error,
        class_name=share.get('class_name', '') if share else '',
        teacher_name=share.get('teacher_name', '') if share else '',
        app_version=APP_VERSION
    )


@app.route('/api/grades/<share_token>/verify', methods=['POST'])
@rate_limit('pin_verify')
async def api_verify_pin(share_token):
    """Verify student PIN and return grade data"""
    data = await request.get_json()
    if not data:
        return jsonify({'success': False, 'message': 'backend.invalidRequest'}), 400

    pin = data.get('pin', '')
    if not pin or len(pin) != 6 or not pin.isdigit():
        return jsonify({'success': False, 'message': 'backend.invalidPin'}), 400

    share = db_layer.get_share(share_token)

    if not share:
        return jsonify({'success': False, 'message': 'backend.invalidAccessLink'}), 404

    if not share.get('active'):
        return jsonify({'success': False, 'message': 'backend.accessRevoked'}), 403

    expires_at = share.get('expires_at')
    if expires_at and datetime.fromisoformat(expires_at) < datetime.now():
        return jsonify({'success': False, 'message': 'backend.accessExpired'}), 403

    # Share-level brute-force lock (survives IP rotation).
    if share_pin_locked(share_token):
        return jsonify({
            'success': False,
            'message': 'backend.tooManyRequests',
            'rate_limited': True,
            'retry_after': SHARE_PIN_WINDOW_SECONDS
        }), 429

    # Find student by PIN
    matched_student_id = None
    for student_id, student_info in share.get('students', {}).items():
        if verify_pin(student_info.get('pin_hash', ''), pin):
            matched_student_id = student_id
            break

    if not matched_student_id:
        record_share_pin_failure(share_token)
        return jsonify({'success': False, 'message': 'backend.wrongPin'}), 401

    # Correct PIN: clear the failure counter for this share.
    share_pin_failures.pop(share_token, None)

    # Get student data from encrypted snapshot
    encrypted_data = share.get('encrypted_data')
    if not encrypted_data:
        return jsonify({'success': False, 'message': 'backend.error'}), 500
    
    # Decrypt the snapshot data
    snapshot = decrypt_share_data(encrypted_data, MASTER_SHARE_KEY)
    
    student_data = None
    for s in snapshot.get('students', []):
        if s.get('id') == matched_student_id:
            student_data = s
            break

    if not student_data:
        return jsonify({'success': False, 'message': 'backend.studentNotFound'}), 404

    # SECURITY: enforce the share's visibility settings server-side. Raw grades
    # are only sent when at least one visible view actually needs them
    # (grades table, chart, category breakdown). When only average/finalGrade
    # are visible, those are computed here and the raw grades stay private —
    # previously the full grade list was always returned and filtering was
    # left to the client, so anyone with a PIN could read hidden grades via
    # the API directly.
    visibility = share.get('visibility') or {}
    grades_visible = bool(visibility.get('grades', True))
    average_visible = bool(visibility.get('average', True))
    final_visible = bool(visibility.get('finalGrade', True))
    chart_visible = bool(visibility.get('chart', False))
    breakdown_visible = bool(visibility.get('categoryBreakdown', False))
    raw_needed = grades_visible or chart_visible or breakdown_visible

    all_grades = student_data.get('grades', [])
    pm_settings = snapshot.get('plusMinusGradeSettings', {})

    # Per-subject stats (server-computed), so the client can show average /
    # final grade even when raw grades are withheld.
    stats = {}
    if average_visible or final_visible:
        for subject in snapshot.get('subjects', []):
            if not isinstance(subject, dict) or subject.get('id') is None:
                continue
            sid = subject['id']
            subject_grades = [g for g in all_grades if isinstance(g, dict) and g.get('subjectId') == sid]
            avg = compute_weighted_average(subject_grades, pm_settings)
            entry = {}
            if average_visible:
                entry['average'] = round(avg, 2)
            if final_visible:
                entry['finalGrade'] = final_grade_label(avg)
            stats[str(sid)] = entry

    return jsonify({
        'success': True,
        'student': {
            'name': get_student_display_name(student_data),
            'grades': all_grades if raw_needed else []
        },
        'class_name': share.get('class_name', ''),
        'teacher_name': share.get('teacher_name', ''),
        'categories': snapshot.get('categories', []) if raw_needed else [],
        'subjects': snapshot.get('subjects', []),
        'plusMinusGradeSettings': pm_settings,
        'visibility': visibility,
        'stats': stats
    })


@app.route('/api/qrcode/generate', methods=['POST'])
@rate_limit('default')
async def api_generate_qr():
    """Generate a QR code for a given URL"""
    if not QR_CODE_AVAILABLE:
        return jsonify({
            'success': False,
            'message': 'QR code library not available on this server'
        }), 500

    try:
        data = await request.get_json()

        if not data or 'url' not in data:
            return jsonify({'success': False, 'message': 'URL is required'}), 400

        url = data['url']
        if not isinstance(url, str) or len(url) > 512:
            return jsonify({'success': False, 'message': 'Invalid URL'}), 400
        
        # Create QR code
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_L,
            box_size=10,
            border=4,
        )
        qr.add_data(url)
        qr.make(fit=True)
        
        # Create image
        img = qr.make_image(fill_color="black", back_color="white")
        
        # Convert to base64
        buffer = BytesIO()
        img.save(buffer, format='PNG')
        img_str = b64.b64encode(buffer.getvalue()).decode()
        
        return jsonify({
            'success': True,
            'qr_code': f"data:image/png;base64,{img_str}"
        })
    except Exception as e:
        print(f"Error generating QR code: {str(e)}")
        return jsonify({
            'success': False, 
            'message': 'Failed to generate QR code'
        }), 500


if __name__ == '__main__':
    DEBUG_MODE = os.environ.get('DEBUG', '').lower() in ('1', 'true', 'yes')
    app.run(host='0.0.0.0', port=1601, debug=DEBUG_MODE)
