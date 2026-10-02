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
import html
import hashlib
import re
import secrets
import functools
import base64
import os
import time
import smtplib
import asyncio
import ssl
import logging
import db as db_layer
import docs_render
import webuntis_client
import moodle_client
import backup as backup_job
import inactivity
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
from pathlib import Path
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from quart import Quart, render_template, request, jsonify, redirect, url_for, make_response, send_file
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
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
    'login_code': (10, 60),     # 10 one-time-code attempts per minute (each pending login also caps at 5)
    'device_unlock': (20, 60),  # silent re-unlock of paired phones (256-bit secret, not guessable)
    'register': (3, 60),        # 3 attempts per minute
    'data_write': (120, 60),    # 120 writes per minute (granular per-class saves)
    'data_read': (240, 60),     # 240 reads per minute (granular per-class loads)
    'pin_verify': (5, 60),      # 5 PIN attempts per minute
    'share_manage': (20, 60),   # 20 share management requests per minute
    'password_reset': (3, 300), # 3 attempts per 5 minutes
    'org_join': (5, 60),        # 5 join-code attempts per minute (brute-force resistance)
    'org_manage': (20, 60),     # 20 org management requests per minute
    'dpa_confirm': (10, 60),    # 10 DPA confirmation-link attempts per minute (token is 256-bit)
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

# PBKDF2 work factors. The data key *is* the password-derived key, so its
# iteration count can only change together with a re-encryption (password
# set/reset). Each account therefore stores its own count (`kdf_iterations`,
# missing = legacy) and new keys use the current OWASP-recommended value.
KDF_ITERATIONS_LEGACY = 100_000
KDF_ITERATIONS_CURRENT = 600_000
PASSWORD_HASH_ITERATIONS_LEGACY = 200_000
PASSWORD_HASH_ITERATIONS_CURRENT = 600_000


def user_kdf_iterations(user: dict | None) -> int:
    return int((user or {}).get('kdf_iterations') or KDF_ITERATIONS_LEGACY)


def derive_encryption_key(password: str, salt: bytes, iterations: int = KDF_ITERATIONS_LEGACY) -> bytes:
    """Derive a 256-bit encryption key from password using PBKDF2"""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,  # 256 bits for AES-256
        salt=salt,
        iterations=iterations,
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
    """Hash password with PBKDF2; the iteration count is part of the stored value
    ("pbkdf2_sha256$<iterations>$<salt>$<hash>") so it can be raised later."""
    salt = secrets.token_bytes(32)
    iterations = PASSWORD_HASH_ITERATIONS_CURRENT
    hashed = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, iterations)
    return f"pbkdf2_sha256${iterations}${salt.hex()}${hashed.hex()}"


def _parse_password_hash(stored_password: str) -> tuple[int, bytes, str]:
    """Return (iterations, salt, hash_hex) for the new and the legacy format."""
    if stored_password.startswith('pbkdf2_sha256$'):
        _, iterations, salt_hex, stored_hash = stored_password.split('$')
        return int(iterations), bytes.fromhex(salt_hex), stored_hash
    salt_hex, stored_hash = stored_password.split(':')
    return PASSWORD_HASH_ITERATIONS_LEGACY, bytes.fromhex(salt_hex), stored_hash


def password_hash_needs_upgrade(stored_password: str) -> bool:
    try:
        return _parse_password_hash(stored_password)[0] < PASSWORD_HASH_ITERATIONS_CURRENT
    except Exception:
        return False


def verify_password(stored_password: str, provided_password: str) -> bool:
    """Verify password against stored hash (new and legacy format)"""
    try:
        iterations, salt, stored_hash = _parse_password_hash(stored_password)
        if len(salt) != 32:
            return False
        provided_hash = hashlib.pbkdf2_hmac('sha256', provided_password.encode(), salt, iterations)
        return secrets.compare_digest(stored_hash, provided_hash.hex())
    except Exception:
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

    # Verify the server certificate and hostname (create_default_context).
    tls_context = ssl.create_default_context()
    if use_tls:
        server = smtplib.SMTP(host, port, timeout=10)
        server.ehlo()
        server.starttls(context=tls_context)
    else:
        server = smtplib.SMTP_SSL(host, port, timeout=10, context=tls_context)
    server.login(user, password)
    server.sendmail(msg['From'], [to_addr], msg.as_string())
    server.quit()
    logger.info("[EMAIL] Email sent to %s", _scrub_email(to_addr))

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


async def send_login_code_email(to_addr: str, username: str, code: str, client: str, ip: str):
    """One-time sign-in code (second factor after the password)."""
    app_url = APP_CONFIG.get('app_url', 'http://localhost:5000').rstrip('/')
    minutes = LOGIN_EMAIL_CODE_TTL_SECONDS // 60
    name, client, ip = (html.escape(v or '') for v in (username, client, ip))
    subject = f"EduGrade – Anmeldecode {code} / Sign-in code"
    html_body = f"""
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem;">
        <h2 style="margin-bottom: 0.5rem;">Dein Anmeldecode</h2>
        <p>Hallo {name},</p>
        <p>jemand meldet sich mit deinem Passwort bei EduGrade an ({client}, IP {ip}). Gib diesen Code dort ein:</p>
        <p style="font-size:2rem;font-weight:bold;letter-spacing:0.3em;font-family:monospace;">{code}</p>
        <p style="color:#888;font-size:0.875rem;">Der Code ist {minutes} Minuten gültig. Warst du das nicht? Dann kennt jemand dein Passwort – ändere es bitte sofort.</p>
        <hr style="border:none;border-top:1px solid #333;margin:1.5rem 0;">
        <p style="color:#888;font-size:0.75rem;">EduGrade &mdash; <a href="{app_url}">{app_url}</a></p>
    </div>
    """
    text_body = (
        f"Dein EduGrade-Anmeldecode: {code}\n\n"
        f"Hallo {username},\n\n"
        f"jemand meldet sich mit deinem Passwort bei EduGrade an ({client}, IP {ip}).\n"
        f"Der Code ist {minutes} Minuten gültig.\n"
        f"Warst du das nicht? Dann kennt jemand dein Passwort – ändere es bitte sofort."
    )
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _send_email_sync, to_addr, subject, html_body, text_body)


async def send_verify_email(to_addr: str, username: str, code: str):
    """Confirmation code right after registering."""
    app_url = APP_CONFIG.get('app_url', 'http://localhost:5000').rstrip('/')
    minutes = REGISTER_VERIFY_TTL_SECONDS // 60
    name = html.escape(username or '')
    subject = f"EduGrade – Bestätigungscode {code} / Confirm your email"
    html_body = f"""
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem;">
        <h2 style="margin-bottom: 0.5rem;">E-Mail-Adresse bestätigen</h2>
        <p>Hallo {name},</p>
        <p>willkommen bei EduGrade! Gib diesen Code ein, um deine E-Mail-Adresse zu bestätigen:</p>
        <p style="font-size:2rem;font-weight:bold;letter-spacing:0.3em;font-family:monospace;">{code}</p>
        <p style="color:#888;font-size:0.875rem;">Der Code ist {minutes} Minuten gültig. Abgelaufen? Melde dich einfach an, dann bekommst du einen neuen Code. Hast du dich nicht registriert? Dann ignoriere diese E-Mail.</p>
        <hr style="border:none;border-top:1px solid #333;margin:1.5rem 0;">
        <p style="color:#888;font-size:0.75rem;">EduGrade &mdash; <a href="{app_url}">{app_url}</a></p>
    </div>
    """
    text_body = (
        f"Dein EduGrade-Bestätigungscode: {code}\n\n"
        f"Hallo {username},\n\n"
        f"willkommen bei EduGrade! Gib diesen Code ein, um deine E-Mail-Adresse zu bestätigen.\n"
        f"Der Code ist {minutes} Minuten gültig.\n"
        f"Hast du dich nicht registriert? Dann ignoriere diese E-Mail."
    )
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _send_email_sync, to_addr, subject, html_body, text_body)


async def send_inactivity_warning_email(to_addr: str, username: str, stage: int, days_left: int, delete_at: datetime):
    """Warning before an inactive account is deleted (stage 1..3 = 30/7/1 days).
    The UI language lives in the encrypted gradebook, so the mail is bilingual."""
    app_url = APP_CONFIG.get('app_url', 'http://localhost:5000').rstrip('/')
    name = html.escape(username or '')
    date_de = delete_at.strftime('%d.%m.%Y')
    date_en = delete_at.strftime('%Y-%m-%d')
    days_de = "1 Tag" if days_left == 1 else f"{days_left} Tagen"
    days_en = "1 day" if days_left == 1 else f"{days_left} days"
    subject = f"EduGrade – Dein Konto wird in {days_de} gelöscht / Your account will be deleted in {days_en}"
    html_body = f"""
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem;">
        <h2 style="margin-bottom: 0.5rem;">Dein Konto wird in {days_de} gelöscht</h2>
        <p>Hallo {name},</p>
        <p>du hast EduGrade seit fast zwölf Monaten nicht mehr genutzt. Inaktive Konten werden gelöscht: Am <strong>{date_de}</strong> werden dein Konto und alle Daten (Klassen, Schüler, Noten) unwiderruflich entfernt.</p>
        <p><strong>Melde dich einfach an, um dein Konto zu behalten.</strong> <a href="{app_url}/login">{app_url}/login</a></p>
        <p style="color:#888;font-size:0.875rem;">Möchtest du deine Daten sichern? Nutze nach der Anmeldung den Export.</p>
        <hr style="border:none;border-top:1px solid #333;margin:1.5rem 0;">
        <h2 style="margin-bottom: 0.5rem;">Your account will be deleted in {days_en}</h2>
        <p>Hello {name},</p>
        <p>You have not used EduGrade for almost twelve months. Inactive accounts are deleted: on <strong>{date_en}</strong> your account and all its data (classes, students, grades) will be permanently removed.</p>
        <p><strong>Simply sign in to keep your account.</strong> <a href="{app_url}/login">{app_url}/login</a></p>
        <p style="color:#888;font-size:0.875rem;">Want to keep a copy of your data? Use the export after signing in.</p>
        <hr style="border:none;border-top:1px solid #333;margin:1.5rem 0;">
        <p style="color:#888;font-size:0.75rem;">EduGrade &mdash; <a href="{app_url}">{app_url}</a></p>
    </div>
    """
    text_body = (
        f"Hallo {username},\n\n"
        f"du hast EduGrade seit fast zwölf Monaten nicht mehr genutzt. Am {date_de} werden dein Konto und alle Daten "
        f"(Klassen, Schüler, Noten) unwiderruflich gelöscht.\n"
        f"Melde dich an, um dein Konto zu behalten: {app_url}/login\n\n"
        f"---\n\n"
        f"Hello {username},\n\n"
        f"You have not used EduGrade for almost twelve months. On {date_en} your account and all its data "
        f"(classes, students, grades) will be permanently deleted.\n"
        f"Sign in to keep your account: {app_url}/login"
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

        # Branding line
        canvas.drawCentredString(PAGE_W / 2, 1.2*cm, 'Powered by EduGrade · developed by avocloud.net')
        canvas.linkURL('https://avocloud.net', (PAGE_W / 2 - 4*cm, 1.0*cm, PAGE_W / 2 + 4*cm, 1.5*cm))

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
    logger.info("[RECOVERY EMAIL] Starting PDF generation for %s", _scrub_email(to_addr))
    pdf_bytes = None
    pdf_error = None
    try:
        pdf_bytes = generate_recovery_key_pdf(username, recovery_key, language)
        print(f"[RECOVERY EMAIL] PDF generated: {len(pdf_bytes)} bytes")
    except Exception as e:
        pdf_error = str(e)
        print(f"[RECOVERY EMAIL] PDF generation error: {e}")

    logger.info("[RECOVERY EMAIL] Sending email to %s with PDF=%s", _scrub_email(to_addr), pdf_bytes is not None)
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
    # The snapshot is master-key encrypted and never shows behavior logs to
    # students, so don't copy them in (filtered copies — user_data is live).
    students = [
        {k: v for k, v in s.items() if k != 'behavior'} if isinstance(s, dict) else s
        for s in students
    ]

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
            # Clients without a behavior checkbox follow their "notes" choice.
            if not include.get('behavior', include.get('comments', True)):
                s['behavior'] = []

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
    # Idempotent: archive DPA signatures already stored in the user documents.
    db_layer.migrate_dpa_signatures_from_users()


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

    # DPA: expired confirmation links, signature proofs older than 3 years
    cleanup_dpa_records()

    return None

CLEANUP_INTERVAL_SECONDS = 60


async def _periodic_cleanup():
    """Run the cleanup continuously, not only at startup: expired session keys
    and the plaintext cache must not outlive their session in RAM."""
    while True:
        await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)
        try:
            await cleanup_expired_sessions()
        except Exception:
            logger.exception("Periodic cleanup failed")
        try:
            await run_daily_jobs()
        except Exception:
            logger.exception("Daily jobs failed")


# ---- daily jobs (inactive-account deletion, database backup) ----
_daily_jobs_day = None  # UTC date string of the last completed run
OPERATOR_EMAIL = os.environ.get('OPERATOR_EMAIL') or APP_CONFIG.get('operator_email') or 'fabian.murauer@avocloud.net'


async def _delete_inactive_account(user: dict) -> None:
    """Same path as DELETE /api/account (db.delete_account also keeps the DPA
    evidence); raises ValueError for an org admin with other members."""
    tokens = db_layer.delete_account(user['email'])
    for tok in tokens:
        clear_session_cache(tok)
    _terminate_user_sessions(user['id'])


async def _send_inactivity_warning(user: dict, stage: int, days_left: int, delete_at: datetime) -> None:
    await send_inactivity_warning_email(user['email'], user.get('username', ''), stage, days_left, delete_at)


async def _notify_operator_inactive_org_admin(user: dict) -> None:
    """Tell the operator an inactive org admin could not be auto-deleted."""
    if not smtp_is_configured():
        return
    subject = "EduGrade: inaktiver Org-Admin nicht gelöscht"
    body = (f"Das Konto {user['id']} ist seit über 12 Monaten inaktiv und wurde nach den Warnungen "
            f"nicht gelöscht, weil es Admin einer Organisation mit weiteren Mitgliedern ist. "
            f"Bitte Admin-Rolle übertragen oder manuell entscheiden.")
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _send_email_sync, OPERATOR_EMAIL, subject, f"<p>{html.escape(body)}</p>", body)


async def run_daily_jobs(now: datetime | None = None, force: bool = False) -> None:
    """Once per UTC day (first cleanup tick after midnight or after a restart;
    the jobs themselves are idempotent): inactivity deletion and DB backup."""
    global _daily_jobs_day
    now = now or datetime.now(timezone.utc)
    today = now.strftime('%Y-%m-%d')
    if _daily_jobs_day == today and not force:
        return
    _daily_jobs_day = today
    if smtp_is_configured():
        await inactivity.run_inactivity_job(_send_inactivity_warning, _delete_inactive_account,
                                            _notify_operator_inactive_org_admin, now)
    else:
        # Never delete without being able to warn.
        logger.warning("SMTP not configured - inactive-account deletion skipped")
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, backup_job.run_daily_backup, now)


# Last day a user's activity was written, so the DB sees at most one write a day.
_last_active_touched: dict[str, str] = {}


def touch_last_active(user_id: str, force: bool = False) -> None:
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    if not force and _last_active_touched.get(user_id) == today:
        return
    try:
        db_layer.touch_last_active(user_id, datetime.now(timezone.utc).isoformat())
        _last_active_touched[user_id] = today
    except Exception as e:
        logger.warning("Could not update last_active_at for user %s: %s", user_id, type(e).__name__)


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


# Student fields that older clients silently drop: the native apps decode the
# blob with ignoreUnknownKeys and post the whole thing back, so e.g. Android
# <= 1.5.5 would wipe every behavior log on its next save. Current clients
# always send these keys, so a missing key means "unknown to this client".
PRESERVED_STUDENT_FIELDS = ('behavior',)


def _students_by_key(data: dict) -> dict:
    """Map (class_id, year_id, student_id) -> student dict of a full blob."""
    students = {}
    for cls in data.get('classes') or []:
        if not isinstance(cls, dict):
            continue
        for year in cls.get('years') or []:
            if not isinstance(year, dict):
                continue
            for s in year.get('students') or []:
                if isinstance(s, dict) and s.get('id') is not None:
                    students[(str(cls.get('id')), str(year.get('id')), str(s['id']))] = s
    return students


def carry_over_student_fields(user_id: str, incoming: dict, encryption_key: bytes):
    """Copy PRESERVED_STUDENT_FIELDS from the stored blob into incoming students
    that lack them. Only decrypts the stored blob when such a student exists."""
    incomplete = {
        key: s for key, s in _students_by_key(incoming).items()
        if any(f not in s for f in PRESERVED_STUDENT_FIELDS)
    }
    if not incomplete:
        return
    stored = _students_by_key(get_user_data(user_id, encryption_key) or {})
    for key, s in incomplete.items():
        old = stored.get(key)
        if not old:
            continue
        for f in PRESERVED_STUDENT_FIELDS:
            if f not in s and f in old:
                s[f] = old[f]

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

    # Check if user already exists. An address that was never confirmed is
    # released after UNVERIFIED_ACCOUNT_TTL_HOURS, so nobody can block someone
    # else's email by registering it first.
    existing = db_layer.get_user_by_email(email)
    if existing is not None and _is_stale_unverified(existing):
        for tok in db_layer.delete_account(email):
            clear_session_cache(tok)
        logger.info("Released unconfirmed account %s for re-registration", existing['id'])
        existing = None
    if existing is not None:
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
    encryption_key = derive_encryption_key(password, encryption_salt, KDF_ITERATIONS_CURRENT)

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
        "kdf_iterations": KDF_ITERATIONS_CURRENT,
        "recovery_key_hash": hash_recovery_key(recovery_key),
        "recovery_salt": recovery_salt.hex(),
        "encrypted_dek": encrypted_dek,
        "account_type": account_type,
        # Without mail there's no way to confirm, so self-hosted setups skip it.
        "email_verified": not smtp_is_configured(),
        "created_at": datetime.now().isoformat(),
        # Registration requires ticking the terms checkbox, so consent to the
        # current version is recorded right away.
        "terms_version": TERMS_VERSION,
        "terms_accepted_at": datetime.now(timezone.utc).isoformat(),
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
        'recovery_key': recovery_key,
        '_dek': encryption_key,   # internal: popped by the route before responding
    }


UNVERIFIED_ACCOUNT_TTL_HOURS = 24


def _is_stale_unverified(user: dict) -> bool:
    """Registered but the email was never confirmed within the grace period.
    Accounts from before confirmation existed have no flag and count as confirmed."""
    if user.get('email_verified') is not False:
        return False
    try:
        created = datetime.fromisoformat(user.get('created_at', ''))
    except (TypeError, ValueError):
        return True
    return datetime.now() - created > timedelta(hours=UNVERIFIED_ACCOUNT_TTL_HOURS)

def _list_active_sessions_for_user(user_id: str, include_device: bool = True) -> list[str]:
    """Return all non-expired session tokens belonging to this user.
    `include_device=False` skips the paired phone's session, which is exempt
    from the single-session rule (the phone is never logged out)."""
    now = datetime.now()
    active = []
    for tok, sess in db_layer.iter_sessions():
        if sess.get('user_id') != user_id:
            continue
        if not include_device and sess.get('device'):
            continue
        try:
            if datetime.fromisoformat(sess.get('expires_at', '')) < now:
                continue
        except (TypeError, ValueError):
            continue
        active.append(tok)
    return active


def _terminate_user_sessions(user_id: str, keep_device: bool = False, only_device: bool = False) -> int:
    """Delete all sessions for a user and clear in-memory caches/keys.
    `keep_device` spares the paired phone's session; `only_device` removes
    nothing but it. Returns the number of sessions removed.
    """
    tokens = [t for t, s in db_layer.iter_sessions()
              if s.get('user_id') == user_id
              and not (keep_device and s.get('device'))
              and not (only_device and not s.get('device'))]
    for tok in tokens:
        db_layer.delete_session(tok)
        clear_session_cache(tok)
    return len(tokens)


def login_user(email: str, password: str, force: bool = False, long_session: bool = False,
               email_code: bool = False) -> dict:
    """Log in a user.

    `long_session=True` (native app clients) issues a 6-month session instead of
    the default 1-hour web session, so app users don't have to re-authenticate
    constantly. Web sessions stay short-lived.

    The password is never enough on its own: paired accounts confirm with the
    code on the phone, all others (and paired ones with `email_code=True`,
    phone not at hand) with a one-time code mailed to the account address.
    The caller sends that mail.
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

    # Raise the stored password hash to the current work factor while we have
    # the plaintext. (The data key keeps its own count until the next
    # password set/reset, see user_kdf_iterations.)
    if password_hash_needs_upgrade(user["password_hash"]):
        fresh = db_layer.get_user_by_email(email)
        if fresh:
            fresh["password_hash"] = hash_password(password)
            db_layer.put_user(email, fresh)
            user = fresh

    # Single-session enforcement: only one active session per user. If another
    # one already exists, refuse the login unless the caller explicitly opts
    # in to take over (`force=True`), in which case the old sessions are
    # invalidated first.
    # The paired phone's session never counts — it stays logged in regardless.
    user_id = user["id"]
    existing_tokens = _list_active_sessions_for_user(user_id, include_device=False)
    if existing_tokens and not force:
        return {
            'success': False,
            'message': 'backend.sessionAlreadyActive',
            'code': 'session_exists',
            'token': None,
            'user': None
        }

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
    encryption_key = derive_encryption_key(password, encryption_salt, user_kdf_iterations(user))

    # The password alone only opens a short-lived pending login; the session is
    # created once the one-time code (phone or email) is typed in
    # (see /api/login/verify-code).
    device = user.get('device')
    if not device and not smtp_is_configured():
        # Self-hosted without mail: no way to deliver a code, so password only
        # (otherwise nobody could sign in at all).
        logger.warning("SMTP not configured — login for user %s without second factor", user_id)
        return finish_login(user, encryption_key, long_session, force)
    if email_code or not device:
        pending_id = create_pending_login(user, encryption_key, long_session, force, channel='email')
        return {
            'success': False,
            'message': 'backend.emailCodeRequired',
            'code': 'email_code_required',
            'pending_id': pending_id,
            'expires_in': LOGIN_EMAIL_CODE_TTL_SECONDS,
            'token': None,
            'user': None
        }
    pending_id = create_pending_login(user, encryption_key, long_session, force)
    return {
        'success': False,
        'message': 'backend.deviceCodeRequired',
        'code': 'device_code_required',
        'pending_id': pending_id,
        'expires_in': LOGIN_CODE_TTL_SECONDS,
        'device_name': device.get('name') or '',
        'token': None,
        'user': None
    }


def _create_session(user_id: str, encryption_key: bytes, long_session: bool, device: bool = False) -> str:
    """Persist a new session and hold its data key in RAM. App clients get a
    long-lived (6-month) session; web stays at 1h."""
    token = generate_session_token()
    session_ttl = timedelta(days=180) if (long_session or device) else timedelta(hours=1)
    db_layer.put_session(token, {
        "user_id": user_id,
        "created_at": datetime.now().isoformat(),
        "expires_at": (datetime.now() + session_ttl).isoformat(),
        "long_session": long_session or device,
        "device": device
    })
    encryption_keys[token] = encryption_key
    return token


def finish_login(user: dict, encryption_key: bytes, long_session: bool, force: bool) -> dict:
    """Second half of a successful login: single-session takeover, session
    creation and v2 migration. Shared by password login and code login."""
    user_id = user["id"]
    email = user["email"]
    if force:
        removed = _terminate_user_sessions(user_id, keep_device=True)
        if removed:
            logger.info("Force-login for user %s terminated %d existing session(s)", user_id, removed)

    token = _create_session(user_id, encryption_key, long_session)
    touch_last_active(user_id, force=True)  # also resets inactivity warnings

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
        'device_paired': bool(user.get('device')),
        'user': {
            'id': user['id'],
            'username': user['username'],
            'email': user['email']
        }
    }


# ============ PAIRED PHONE (account anchor) ============
# One phone per account can be paired. The phone generates a 256-bit secret
# (kept in the Android Keystore); the server stores only its SHA-256 and the
# data key (DEK) wrapped with a key derived from it — same zero-knowledge
# pattern as the recovery-key-wrapped `encrypted_dek`. With it the phone can
# silently re-unlock after a server restart, so it is never logged out.
# Browser (or other-device) logins for paired accounts need a one-time code
# the phone displays.

LOGIN_CODE_TTL_SECONDS = 180
# Backup when the phone isn't at hand: password + code by email. Mail can be
# slow, so the code lives longer than the phone code.
LOGIN_EMAIL_CODE_TTL_SECONDS = 600
LOGIN_EMAIL_RESEND_SECONDS = 60
LOGIN_EMAIL_MAX_SENDS = 5           # first mail + 4 resends per pending login
# Confirmation code right after registering: the recovery-key dialog comes
# first, so it needs more time than a login code.
REGISTER_VERIFY_TTL_SECONDS = 1800
LOGIN_CODE_MAX_ATTEMPTS = 5
MAX_PENDING_LOGINS_PER_USER = 3
# Passwordless logins (email + phone code) are guessable by anyone who knows
# the email, 5 tries at a time. Cap wrong codes per account per day; past the
# cap the account falls back to password + code until the window passes.
PASSWORDLESS_MAX_FAILURES = 10
PASSWORDLESS_WINDOW_SECONDS = 24 * 60 * 60
passwordless_failures = defaultdict(list)   # user_id -> [failure timestamps]

# pending_id -> {user_id, email, dek, long_session, force, code, expires_ts,
#                attempts, created_at, ip, user_agent, denied}
# In memory on purpose: it holds a DEK for at most LOGIN_CODE_TTL_SECONDS.
# ponytail: per-process; fine for single-worker, like encryption_keys.
pending_logins = {}


def _purge_pending_logins():
    now_ts = time.time()
    for pid in [p for p, e in pending_logins.items() if e['expires_ts'] < now_ts]:
        pending_logins.pop(pid, None)


def _describe_user_agent(ua: str) -> str:
    """Short 'Browser on OS' label for the phone's confirmation screen."""
    ua = ua or ''
    browser = next((name for key, name in (
        ('Edg/', 'Edge'), ('OPR/', 'Opera'), ('Firefox/', 'Firefox'), ('SamsungBrowser', 'Samsung Internet'),
        ('Chrome/', 'Chrome'), ('Safari/', 'Safari'), ('okhttp', 'EduGrade App')) if key in ua), 'Browser')
    system = next((name for key, name in (
        ('Windows', 'Windows'), ('Android', 'Android'), ('iPhone', 'iOS'), ('iPad', 'iPadOS'),
        ('Mac OS', 'macOS'), ('CrOS', 'ChromeOS'), ('Linux', 'Linux')) if key in ua), '')
    return f"{browser} · {system}" if system else browser


def passwordless_locked(user_id: str) -> bool:
    cutoff = time.time() - PASSWORDLESS_WINDOW_SECONDS
    passwordless_failures[user_id] = [t for t in passwordless_failures[user_id] if t > cutoff]
    return len(passwordless_failures[user_id]) >= PASSWORDLESS_MAX_FAILURES


def _pending_ttl(channel: str, purpose: str) -> int:
    if purpose == 'verify':
        return REGISTER_VERIFY_TTL_SECONDS
    return LOGIN_EMAIL_CODE_TTL_SECONDS if channel == 'email' else LOGIN_CODE_TTL_SECONDS


def create_pending_login(user: dict, encryption_key: bytes | None, long_session: bool, force: bool,
                         channel: str = 'device', purpose: str = 'login') -> str:
    """`encryption_key=None` = passwordless: the data key is supplied later by
    the paired phone (attach step), and the code is only revealed once it is.
    `channel='email'`: the code goes out by email and the phone never sees it.
    `purpose='verify'`: email confirmation after registering (different mail)."""
    _purge_pending_logins()
    mine = sorted((e['created_ts'], p) for p, e in pending_logins.items() if e['user_id'] == user['id'])
    for _, pid in mine[:max(0, len(mine) - MAX_PENDING_LOGINS_PER_USER + 1)]:
        pending_logins.pop(pid, None)
    pending_id = secrets.token_urlsafe(24)
    now_ts = time.time()
    pending_logins[pending_id] = {
        'user_id': user['id'],
        'email': user['email'],
        'dek': encryption_key,
        'long_session': long_session,
        'force': force,
        'code': f"{secrets.randbelow(10 ** 6):06d}",
        'created_ts': now_ts,
        'expires_ts': now_ts + _pending_ttl(channel, purpose),
        'attempts': 0,
        'ip': get_client_ip(),
        'user_agent': _describe_user_agent(request.headers.get('User-Agent', '')),
        'denied': False,
        'passwordless': encryption_key is None,
        'channel': channel,
        'purpose': purpose,
        'sends': 0,
        'sent_ts': 0,
    }
    return pending_id


def _unwrap_device_dek(user: dict, secret: bytes | None) -> bytes | None:
    """Data key via the paired phone's secret, or None if it doesn't match."""
    device = user.get('device')
    if not (secret and device and secrets.compare_digest(_device_secret_hash(secret), device.get('secret_hash', ''))):
        return None
    try:
        return decrypt_bytes(device['wrapped_dek'], _device_wrap_key(secret, bytes.fromhex(device['salt'])))
    except Exception:
        return None


def _decode_device_secret(raw) -> bytes | None:
    """The phone sends its secret base64-encoded; require >= 256 bits."""
    try:
        secret = base64.b64decode(str(raw or ''), validate=True)
    except Exception:
        return None
    return secret if len(secret) >= 32 else None


def _device_wrap_key(secret: bytes, salt: bytes) -> bytes:
    # The secret is already uniformly random, so HKDF (not a slow KDF) suffices.
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=salt,
                info=b'edugrade-device-dek-wrap').derive(secret)


def _device_secret_hash(secret: bytes) -> str:
    return hashlib.sha256(b'edugrade-device-auth:' + secret).hexdigest()


def pair_device(user: dict, secret: bytes, name: str, dek: bytes) -> dict:
    """Store (or replace) the paired phone for `user`. Returns the device record."""
    salt = secrets.token_bytes(16)
    device = {
        'id': secrets.token_hex(12),
        'name': (name or '').strip()[:60] or 'Smartphone',
        'paired_at': datetime.now().isoformat(),
        'last_seen': datetime.now().isoformat(),
        'salt': salt.hex(),
        'secret_hash': _device_secret_hash(secret),
        'wrapped_dek': encrypt_bytes(dek, _device_wrap_key(secret, salt)),
    }
    user['device'] = device
    db_layer.put_user(user['email'], user)
    return device


def unpair_device(user: dict) -> None:
    """Forget the paired phone. Its session keeps working as an ordinary
    (non-exempt) app session, so unpairing never logs anybody out."""
    if user.pop('device', None) is None:
        return
    db_layer.put_user(user['email'], user)
    for tok, sess in db_layer.iter_sessions():
        if sess.get('user_id') == user['id'] and sess.get('device'):
            sess['device'] = False
            db_layer.put_session(tok, sess)
    for pid in [p for p, e in pending_logins.items() if e['user_id'] == user['id']]:
        pending_logins.pop(pid, None)


def _session_for_request() -> dict | None:
    token = get_token_from_request()
    return db_layer.get_session(token) if token else None

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
            'account_type': user_info.get('account_type', 'teacher'),
            'school': user_info.get('school', ''),
            'dpa_version': user_info.get('dpa_version'),
            'dpa_basis': user_info.get('dpa_basis'),
            'dpa_org_id': user_info.get('dpa_org_id'),
            'terms_version': user_info.get('terms_version'),
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

        touch_last_active(user['id'])  # at most one DB write per user and day

        # The whole API stays locked until the DPA is signed (see /avv/sign),
        # except the few calls the signing step and the login itself need.
        if needs_dpa_signature(user) and not _dpa_exempt(request.path, request.method):
            return jsonify({'success': False, 'message': 'backend.dpaRequired', 'dpa_required': True}), 403

        # After the DPA (so the user signs that first), changed terms lock all
        # write calls until accepted in the in-app modal. Reads and export stay open.
        if needs_terms_acceptance(user) and not _terms_exempt(request.path, request.method):
            return jsonify({'success': False, 'message': 'backend.termsRequired', 'terms_required': True}), 403

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

# Version of the data processing agreement (/avv). Every account has to sign
# it once (/avv/sign) before using the app; bumping the version makes
# everyone sign again, so only do that when the text changes materially.
DPA_VERSION = '1.1'
DPA_SIGNER_NAME_MAX = 100


# API paths usable without a signed DPA: the signing call itself, deleting the
# account (a way out for someone who does not agree), session housekeeping,
# the announcement banner, the school list the signing form pre-fills from and
# the phone-code login flow (the paired phone has to hand out the code before
# the account can even reach the signing page).
_DPA_EXEMPT_PATHS = (
    '/api/dpa/accept', '/api/dpa/status', '/api/dpa/resend', '/api/heartbeat', '/api/disconnect',
    '/api/announcement', '/api/schools', '/api/profile/school',
    '/api/device/status', '/api/device/login-requests',
)
DPA_MIN_READ_SECONDS = 60


def _dpa_text_hash() -> str:
    """SHA-256 over the German and English contract templates as shipped, so a
    signature can be tied to the exact text that was shown."""
    h = hashlib.sha256()
    for name in ('_dpa_content.html', '_dpa_content_en.html'):
        h.update((Path(__file__).parent / 'templates' / name).read_bytes())
    return h.hexdigest()


def _dpa_exempt(path: str, method: str) -> bool:
    if path == '/api/account' and method == 'DELETE':
        return True
    return path.startswith(_DPA_EXEMPT_PATHS)


def _org_dpa_confirmed(org_id: str) -> bool:
    """True if the school-level DPA of *org_id* is signed for the current version.
    Orgs without a row (all pre-existing ones) or with an old version are 'pending'."""
    row = db_layer.get_org_dpa(org_id)
    return bool(row and row.get('version') == DPA_VERSION)


def needs_dpa_signature(user: dict) -> bool:
    """True if *user* (from get_user_from_token) hasn't signed the current DPA.

    A signature on the 'org' basis only counts while the user is still an
    approved member of that org and the org's school DPA is confirmed; leaving
    or being removed sends the user back to the signing page."""
    if user.get('dpa_version') != DPA_VERSION:
        return True
    if user.get('dpa_basis') == 'org':
        m = db_layer.get_org_membership(user.get('id'))
        return not (m and m.get('status') == 'approved'
                    and m.get('org_id') == user.get('dpa_org_id')
                    and _org_dpa_confirmed(m['org_id']))
    return False


# Version of the terms of service (/terms). Material changes need active
# consent: bumping the version shows every account the in-app consent modal
# and locks write calls until it is accepted. Accounts without a stored
# terms_version (created before this existed) see the modal once.
TERMS_VERSION = '2.0'

# Write calls allowed while the terms are not accepted yet: the accept call,
# the way out (account deletion), session housekeeping, the announcement
# banner and the phone-code login flow. Reading (GET) and exporting stay open.
_TERMS_EXEMPT_PATHS = (
    '/api/terms/accept', '/api/heartbeat', '/api/disconnect',
    '/api/announcement', '/api/device/status', '/api/device/login-requests',
)


def needs_terms_acceptance(user: dict) -> bool:
    """True if *user* hasn't accepted the current terms of service."""
    return user.get('terms_version') != TERMS_VERSION


def _terms_exempt(path: str, method: str) -> bool:
    if method in ('GET', 'HEAD', 'OPTIONS'):
        return True
    if path == '/api/account' and method == 'DELETE':
        return True
    return path.startswith(_TERMS_EXEMPT_PATHS)
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
    app.add_background_task(_periodic_cleanup)
    print("Database initialized successfully")
    # Operator console (stats, announcements, …) on the server's stdin — type
    # `help` in the hosting panel. See manage.py.
    try:
        import manage
        manage.start_in_server()
    except Exception as e:
        logger.warning("Server console not started: %s", e)

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
        # All scripts, styles and fonts are self-hosted under /static/vendor.
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; "
        "font-src 'self' data:; "
        "connect-src 'self'; "
        "frame-src 'none'; "
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

def _moved_param() -> dict:
    """Carry only ?moved= (domain-move.js welcome on edugrade.at) across the
    / <-> /login redirects. Never pass request.args wholesale to url_for: keys
    like endpoint/_external/_scheme are url_for's own arguments."""
    moved = request.args.get('moved')
    return {'moved': moved} if moved in ('de', 'en') else {}


@app.route('/')
async def index():
    """Main page - requires login"""
    token = get_token_from_request()
    user = get_user_from_token(token)

    if not user:
        return redirect(url_for('login_page', **_moved_param()))

    if needs_dpa_signature(user):
        return redirect(url_for('dpa_sign_page'))

    return await render_template('index.html', user=user, app_version=APP_VERSION, version_string=VERSION_STRING, build_date=BUILD_DATE,
                                 terms_required=needs_terms_acceptance(user), terms_version=TERMS_VERSION)


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
        return redirect(url_for('index', **_moved_param()))

    return await render_template('login.html', app_version=APP_VERSION)


@app.route('/terms')
async def terms():
    return await render_template('terms.html', app_version=APP_VERSION)

@app.route('/impressum')
async def impressum():
    """Legal notice lives on avocloud.net and also covers edugrade.at."""
    return redirect('https://avocloud.net/impressum/', code=302)


@app.route('/privacy')
async def privacy():
    return await render_template('privacy.html', app_version=APP_VERSION)

@app.route('/avv')
@app.route('/dpa')
async def dpa():
    return await render_template('dpa.html', app_version=APP_VERSION, dpa_version=DPA_VERSION)


# --- DPA signing: three paths (see LEGAL_FIXES.md A1) -------------------------
# dpa_basis on the user document / in dpa_signatures:
#   org              signed via the school's org (org DPA confirmed by principal)
#   school_pending   signed personally, principal asked to confirm via link
#   school_confirmed ... and the principal has confirmed
#   personal         signed on own responsibility
DPA_CONFIRM_TTL_DAYS = 14
DPA_CONFIRM_ROLES = ('principal', 'delegated')
DPA_ROLE_MAX = 100
DPA_RETENTION_DAYS = 3 * 365 + 1  # proof kept 3 years after the contract ended
_EMAIL_RE = re.compile(r'^[^@\s]{1,64}@[^@\s]{1,253}\.[^@\s.]{2,}$')


def _dpa_lang(value) -> str:
    return 'en' if value == 'en' else 'de'


def _dpa_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _dpa_confirm_link(token: str) -> str:
    app_url = APP_CONFIG.get('app_url', 'http://localhost:5000').rstrip('/')
    return f"{app_url}/avv/confirm/{token}"


async def send_dpa_confirmation_email(to_addr: str, signer_name: str, school: str,
                                      link: str, kind: str, lang: str = 'de'):
    """Ask a school principal to confirm the DPA (best-effort template, de/en).
    kind 'org' = for the whole organisation, 'personal' = for one teacher."""
    app_url = APP_CONFIG.get('app_url', 'http://localhost:5000').rstrip('/')
    n, sch = html.escape(signer_name), html.escape(school or '')
    lk = html.escape(link, quote=True)
    if lang == 'en':
        subject = f"EduGrade – please confirm the data processing agreement for {school}"
        scope = ("for all teachers of the organisation" if kind == 'org'
                 else "for this teacher")
        intro = (f"{signer_name} uses EduGrade for the school {school} and asks you, as head of school "
                 f"or authorised person, to confirm the data processing agreement (DPA) {scope}.")
        body_html = f"""
        <h2 style="margin-bottom:0.5rem;">Confirm the data processing agreement</h2>
        <p><strong>{n}</strong> uses EduGrade for <strong>{sch}</strong> and asks you, as head of school or
        authorised person, to confirm the data processing agreement (DPA) {scope}.</p>
        <p>You can read the full agreement on the confirmation page. Until you confirm, the agreement
        applies to the teacher personally.</p>
        <p><a href="{lk}" style="display:inline-block;padding:0.6rem 1.2rem;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;">Read and confirm the agreement</a></p>
        <p style="color:#888;font-size:0.8rem;">The link is valid for {DPA_CONFIRM_TTL_DAYS} days and can be used once.
        If you do not know this person, ignore this e-mail. Privacy information: {app_url}/privacy</p>"""
        text_body = (f"{intro}\n\nYou can read and confirm the agreement here "
                     f"(valid {DPA_CONFIRM_TTL_DAYS} days, single use):\n{link}\n\n"
                     "Until you confirm, the agreement applies to the teacher personally. "
                     "If you do not know this person, ignore this e-mail.")
    else:
        subject = f"EduGrade – bitte Auftragsverarbeitungsvertrag für {school} bestätigen"
        scope = ("für alle Lehrkräfte der Organisation" if kind == 'org'
                 else "für diese Lehrkraft")
        intro = (f"{signer_name} nutzt EduGrade für die Schule {school} und bittet Sie als Schulleitung "
                 f"oder bevollmächtigte Person, den Auftragsverarbeitungsvertrag (AVV) {scope} zu bestätigen.")
        body_html = f"""
        <h2 style="margin-bottom:0.5rem;">Auftragsverarbeitungsvertrag bestätigen</h2>
        <p><strong>{n}</strong> nutzt EduGrade für die Schule <strong>{sch}</strong> und bittet Sie als
        Schulleitung oder bevollmächtigte Person, den Auftragsverarbeitungsvertrag (AVV) {scope} zu bestätigen.</p>
        <p>Den vollständigen Vertrag können Sie auf der Bestätigungsseite lesen. Bis zu Ihrer Bestätigung
        gilt der Vertrag mit der Lehrkraft persönlich.</p>
        <p><a href="{lk}" style="display:inline-block;padding:0.6rem 1.2rem;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;">Vertrag lesen und bestätigen</a></p>
        <p style="color:#888;font-size:0.8rem;">Der Link ist {DPA_CONFIRM_TTL_DAYS} Tage gültig und nur einmal verwendbar.
        Kennen Sie diese Person nicht, ignorieren Sie diese E-Mail. Datenschutzhinweise: {app_url}/privacy</p>"""
        text_body = (f"{intro}\n\nDen Vertrag können Sie hier lesen und bestätigen "
                     f"({DPA_CONFIRM_TTL_DAYS} Tage gültig, einmal verwendbar):\n{link}\n\n"
                     "Bis zu Ihrer Bestätigung gilt der Vertrag mit der Lehrkraft persönlich. "
                     "Kennen Sie diese Person nicht, ignorieren Sie diese E-Mail.")
    html_body = f"""
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem;">
        {body_html}
        <hr style="border:none;border-top:1px solid #333;margin:1.5rem 0;">
        <p style="color:#888;font-size:0.75rem;">EduGrade &mdash; <a href="{app_url}">{app_url}</a></p>
    </div>
    """
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _send_email_sync, to_addr, subject, html_body, text_body)


def _new_dpa_confirmation(kind: str, user_id: str, org_id: str | None, email: str) -> str:
    """Create a one-time confirmation link row (hash only) and return the raw token."""
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    db_layer.put_dpa_confirmation(
        _dpa_token_hash(token), kind, user_id, org_id, DPA_VERSION, email,
        now.isoformat(), (now + timedelta(days=DPA_CONFIRM_TTL_DAYS)).isoformat())
    return token


def _valid_confirmation(token: str) -> dict | None:
    """The open, unexpired confirmation row for *token* (current DPA version), or None."""
    row = db_layer.get_dpa_confirmation(_dpa_token_hash(token or ''))
    if not row or row['version'] != DPA_VERSION:
        return None
    if datetime.fromisoformat(row['expires_at']) < datetime.now(timezone.utc):
        return None
    return row


def _dpa_org_context(user_id: str) -> dict:
    """What the signing form needs to know about the user's org (if any)."""
    m = db_layer.get_org_membership(user_id)
    org = db_layer.get_org(m['org_id']) if m and m.get('status') == 'approved' else None
    if not org:
        return {'org': None, 'org_confirmed': False, 'is_admin': False}
    return {'org': org, 'org_confirmed': _org_dpa_confirmed(org['id']),
            'is_admin': m.get('role') == 'admin'}


@app.route('/avv/sign')
async def dpa_sign_page():
    """Mandatory signing step for accounts without the current DPA."""
    user = get_user_from_token(get_token_from_request())
    if not user:
        return redirect(url_for('login_page', **_moved_param()))
    if not needs_dpa_signature(user):
        return redirect(url_for('index'))
    stored = db_layer.get_user_by_email(user['email'])
    if stored and stored.get('dpa_shown_version') != DPA_VERSION:
        stored['dpa_shown_version'] = DPA_VERSION
        stored['dpa_shown_at'] = datetime.now(timezone.utc).isoformat()
        db_layer.put_user(stored['email'], stored)
    ctx = _dpa_org_context(user['id'])
    return await render_template('dpa_sign.html', app_version=APP_VERSION, dpa_version=DPA_VERSION,
                                 user=user, resign=bool(user.get('dpa_version')),
                                 org_name=ctx['org']['name'] if ctx['org'] else '',
                                 org_available=bool(ctx['org'] and ctx['org_confirmed']),
                                 org_principal_option=bool(ctx['org'] and ctx['is_admin'] and not ctx['org_confirmed']),
                                 mail_available=smtp_is_configured())


@app.route('/api/dpa/accept', methods=['POST'])
@login_required
async def api_dpa_accept():
    """Record the electronic signature of the DPA (Art. 28(9) GDPR).

    ``choice`` selects the path: ``org`` (via the school's org), ``school``
    (own signature, principal confirms via link), ``personal`` (own
    responsibility) or ``org_principal`` (an org admin who is the principal or
    authorised signs for the whole org)."""
    data = await request.get_json() or {}
    name = ' '.join(str(data.get('name') or '').split())[:DPA_SIGNER_NAME_MAX]
    school = _normalize_school(data.get('school'))
    choice = data.get('choice')
    lang = _dpa_lang(data.get('lang'))
    if (len(name) < 3 or data.get('accepted') is not True or data.get('version') != DPA_VERSION
            or choice not in ('org', 'school', 'personal', 'org_principal')):
        return jsonify({'success': False, 'message': 'backend.invalidRequest'}), 400

    user = db_layer.get_user_by_email(request.user['email'])  # type: ignore
    if not user:
        return jsonify({'success': False}), 404

    # The minimum reading time is enforced here too, not only by the button:
    # the contract has to have been served at least a minute ago.
    now = datetime.now(timezone.utc)
    shown_at = None
    if user.get('dpa_shown_version') == DPA_VERSION and user.get('dpa_shown_at'):
        try:
            shown_at = datetime.fromisoformat(user['dpa_shown_at'])
            if shown_at.tzinfo is None:
                shown_at = shown_at.replace(tzinfo=timezone.utc)
        except ValueError:
            shown_at = None
    if shown_at is None or (now - shown_at).total_seconds() < DPA_MIN_READ_SECONDS:
        return jsonify({'success': False, 'message': 'backend.dpaTooFast'}), 400

    ctx = _dpa_org_context(user['id'])
    org = ctx['org']
    basis, org_id = choice, None
    confirmed_by = (None, None, None)
    send = None  # (kind, org_id, email) when a confirmation link has to go out

    if choice == 'org':
        if not (org and ctx['org_confirmed']):
            return jsonify({'success': False, 'message': 'backend.dpaOrgNotConfirmed'}), 400
        basis, org_id = 'org', org['id']
        school = school or org.get('name', '')
    elif choice == 'org_principal':
        role = data.get('role')
        if not (org and ctx['is_admin']) or role not in DPA_CONFIRM_ROLES:
            return jsonify({'success': False, 'message': 'backend.invalidRequest'}), 400
        school = school or org['name']
        basis, org_id = 'org', org['id']
        confirmed_by = (name, role, now.isoformat())
    elif choice == 'school':
        email = str(data.get('principal_email') or '').strip()[:254]
        if (not _EMAIL_RE.match(email) or data.get('school_ack') is not True
                or len(school) < 2 or email.lower() == user['email'].lower()):
            return jsonify({'success': False, 'message': 'backend.dpaPrincipalInvalid'}), 400
        if not smtp_is_configured():
            return jsonify({'success': False, 'message': 'backend.dpaMailNotConfigured'}), 400
        basis = 'school_pending'
        if org and ctx['is_admin'] and not ctx['org_confirmed']:
            send = ('org', org['id'], email)
            org_id = org['id']
        else:
            send = ('personal', None, email)
    else:
        if data.get('personal_ack') is not True:
            return jsonify({'success': False, 'message': 'backend.invalidRequest'}), 400
        basis = 'personal'

    token = None
    if send:
        # Send first, persist only on success: a failed mail must not leave a
        # signature that nobody can ever confirm.
        token = secrets.token_urlsafe(32)
        try:
            await send_dpa_confirmation_email(send[2], name, school, _dpa_confirm_link(token),
                                              send[0], lang)
        except Exception as e:
            logger.warning("Failed to send DPA confirmation mail: %s", type(e).__name__)
            return jsonify({'success': False, 'message': 'backend.dpaMailFailed'}), 502

    # Keep earlier signatures instead of overwriting them.
    if user.get('dpa_version'):
        user.setdefault('dpa_history', []).append({
            'version': user.get('dpa_version'),
            'accepted_at': user.get('dpa_accepted_at'),
            'signer_name': user.get('dpa_signer_name'),
            'signer_school': user.get('dpa_signer_school'),
            'text_sha256': user.get('dpa_text_sha256'),
            'basis': user.get('dpa_basis'),
            'org_id': user.get('dpa_org_id'),
        })
    text_hash = _dpa_text_hash()
    user['dpa_version'] = DPA_VERSION
    user['dpa_accepted_at'] = now.isoformat()  # UTC, offset included
    user['dpa_text_sha256'] = text_hash
    user['dpa_signer_name'] = name
    user['dpa_signer_school'] = school
    user['dpa_basis'] = basis
    if org_id:
        user['dpa_org_id'] = org_id
    else:
        user.pop('dpa_org_id', None)
    db_layer.put_user(user['email'], user)
    db_layer.add_dpa_signature(
        user['id'], DPA_VERSION, now.isoformat(), name, school, basis, text_hash,
        org_id=org_id, confirmed_by_name=confirmed_by[0], confirmed_by_role=confirmed_by[1],
        confirmed_at=confirmed_by[2])
    if choice == 'org_principal':
        db_layer.set_org_dpa(org_id, DPA_VERSION, school, name, confirmed_by[1],
                             now.isoformat(), text_hash)
    if send:
        now_c = datetime.now(timezone.utc)
        db_layer.put_dpa_confirmation(
            _dpa_token_hash(token), send[0], user['id'], send[1], DPA_VERSION, send[2],
            now_c.isoformat(), (now_c + timedelta(days=DPA_CONFIRM_TTL_DAYS)).isoformat())
    logger.info("DPA %s signed by user %s (%s)", DPA_VERSION, user['id'], basis)
    return jsonify({'success': True, 'basis': basis})


@app.route('/api/dpa/status', methods=['GET'])
@login_required
async def api_dpa_status():
    """The caller's DPA basis and whether a principal confirmation is open."""
    user = db_layer.get_user_by_id(request.user['id'])  # type: ignore
    ctx = _dpa_org_context(request.user['id'])  # type: ignore
    kind = 'org' if (ctx['org'] and ctx['is_admin']) else 'personal'
    pending = db_layer.get_dpa_confirmation_for(request.user['id'], kind) if user else None  # type: ignore
    return jsonify({
        'success': True,
        'basis': (user or {}).get('dpa_basis'),
        'version': (user or {}).get('dpa_version'),
        'confirmation_open': bool(pending and _valid_confirmation_row_ok(pending)),
        'org': ({'id': ctx['org']['id'], 'name': ctx['org']['name'],
                 'dpa_confirmed': ctx['org_confirmed'], 'is_admin': ctx['is_admin']}
                if ctx['org'] else None),
    })


def _valid_confirmation_row_ok(row: dict) -> bool:
    return (row['version'] == DPA_VERSION
            and datetime.fromisoformat(row['expires_at']) >= datetime.now(timezone.utc))


@app.route('/api/dpa/resend', methods=['POST'])
@rate_limit('org_manage')
@login_required
async def api_dpa_resend():
    """Send the principal confirmation link again (e.g. after it expired).
    Only for a signature that is still on the school_pending basis."""
    data = await request.get_json() or {}
    user_id = request.user['id']  # type: ignore
    user = db_layer.get_user_by_id(user_id)
    if not user or user.get('dpa_basis') != 'school_pending' or user.get('dpa_version') != DPA_VERSION:
        return jsonify({'success': False, 'message': 'backend.invalidRequest'}), 400
    ctx = _dpa_org_context(user_id)
    kind = 'org' if (ctx['org'] and ctx['is_admin'] and not ctx['org_confirmed']) else 'personal'
    old = db_layer.get_dpa_confirmation_for(user_id, kind)
    email = str(data.get('principal_email') or (old or {}).get('principal_email') or '').strip()[:254]
    if not _EMAIL_RE.match(email):
        return jsonify({'success': False, 'message': 'backend.dpaPrincipalInvalid'}), 400
    if not smtp_is_configured():
        return jsonify({'success': False, 'message': 'backend.dpaMailNotConfigured'}), 400
    org_id = ctx['org']['id'] if kind == 'org' else None
    token = _new_dpa_confirmation(kind, user_id, org_id, email)
    try:
        await send_dpa_confirmation_email(email, user.get('dpa_signer_name', ''),
                                          user.get('dpa_signer_school', ''),
                                          _dpa_confirm_link(token), kind, _dpa_lang(data.get('lang')))
    except Exception as e:
        logger.warning("Failed to send DPA confirmation mail: %s", type(e).__name__)
        db_layer.delete_dpa_confirmation(_dpa_token_hash(token))
        return jsonify({'success': False, 'message': 'backend.dpaMailFailed'}), 502
    return jsonify({'success': True, 'message': 'backend.dpaConfirmationSent'})


@app.route('/api/org/dpa/request', methods=['POST'])
@rate_limit('org_manage')
@login_required
@org_admin_required
async def api_org_dpa_request():
    """Org owner asks the principal to confirm the school DPA (mail link), or
    confirms it himself as principal/authorised person (``self``: true)."""
    data = await request.get_json() or {}
    org_id = request.org_id  # type: ignore
    user_id = request.user['id']  # type: ignore
    org = db_layer.get_org(org_id)
    if not org:
        return jsonify({'success': False, 'message': 'backend.invalidRequest'}), 400
    if _org_dpa_confirmed(org_id):
        return jsonify({'success': False, 'message': 'backend.dpaOrgAlreadyConfirmed'}), 409
    lang = _dpa_lang(data.get('lang'))
    if data.get('self') is True:
        name = ' '.join(str(data.get('name') or '').split())[:DPA_SIGNER_NAME_MAX]
        role = data.get('role')
        if len(name) < 3 or role not in DPA_CONFIRM_ROLES or data.get('accepted') is not True:
            return jsonify({'success': False, 'message': 'backend.invalidRequest'}), 400
        now = datetime.now(timezone.utc).isoformat()
        db_layer.set_org_dpa(org_id, DPA_VERSION, org['name'], name, role, now, _dpa_text_hash())
        db_layer.delete_dpa_confirmation_for(user_id, 'org')
        owner = db_layer.get_user_by_id(user_id)
        if owner and owner.get('dpa_basis') == 'school_pending' and owner.get('dpa_version') == DPA_VERSION:
            owner['dpa_basis'] = 'school_confirmed'
            db_layer.put_user(owner['email'], owner)
            db_layer.confirm_dpa_signature(user_id, DPA_VERSION, name, role, now)
        return jsonify({'success': True, 'message': 'backend.dpaOrgConfirmed'})
    email = str(data.get('principal_email') or '').strip()[:254]
    if not _EMAIL_RE.match(email):
        return jsonify({'success': False, 'message': 'backend.dpaPrincipalInvalid'}), 400
    if not smtp_is_configured():
        return jsonify({'success': False, 'message': 'backend.dpaMailNotConfigured'}), 400
    owner = db_layer.get_user_by_id(user_id) or {}
    token = _new_dpa_confirmation('org', user_id, org_id, email)
    try:
        await send_dpa_confirmation_email(email, owner.get('dpa_signer_name') or owner.get('username', ''),
                                          org['name'], _dpa_confirm_link(token), 'org', lang)
    except Exception as e:
        logger.warning("Failed to send DPA confirmation mail: %s", type(e).__name__)
        db_layer.delete_dpa_confirmation(_dpa_token_hash(token))
        return jsonify({'success': False, 'message': 'backend.dpaMailFailed'}), 502
    return jsonify({'success': True, 'message': 'backend.dpaConfirmationSent'})


@app.route('/avv/confirm/<token>')
async def dpa_confirm_page(token):
    """Public page (no login) where a principal reads and confirms the DPA."""
    row = _valid_confirmation(token)
    school, signer = '', ''
    if row:
        if row['kind'] == 'org' and row['org_id']:
            org = db_layer.get_org(row['org_id'])
            school = (org or {}).get('name', '')
        u = db_layer.get_user_by_id(row['user_id']) or {}
        signer = u.get('dpa_signer_name') or u.get('username', '')
        school = school or u.get('dpa_signer_school', '')
    return await render_template('dpa_confirm.html', app_version=APP_VERSION, dpa_version=DPA_VERSION,
                                 valid=bool(row), kind=(row or {}).get('kind', ''),
                                 school=school, signer=signer, token=token if row else '')


@app.route('/api/dpa/confirm/<token>', methods=['POST'])
@rate_limit('dpa_confirm')
async def api_dpa_confirm(token):
    """Principal confirmation of a teacher's or an organisation's DPA."""
    row = _valid_confirmation(token)
    if not row:
        return jsonify({'success': False, 'message': 'backend.dpaLinkInvalid'}), 404
    data = await request.get_json() or {}
    name = ' '.join(str(data.get('name') or '').split())[:DPA_SIGNER_NAME_MAX]
    role = data.get('role')
    school = _normalize_school(data.get('school'))
    if len(name) < 3 or role not in DPA_CONFIRM_ROLES or len(school) < 2 or data.get('accepted') is not True:
        return jsonify({'success': False, 'message': 'backend.invalidRequest'}), 400

    now = datetime.now(timezone.utc).isoformat()
    user = db_layer.get_user_by_id(row['user_id'])
    if row['kind'] == 'org':
        if not row['org_id'] or not db_layer.get_org(row['org_id']):
            return jsonify({'success': False, 'message': 'backend.dpaLinkInvalid'}), 404
        db_layer.set_org_dpa(row['org_id'], DPA_VERSION, school, name, role, now, _dpa_text_hash())
    # The signer's own signature moves from pending to confirmed.
    if user and user.get('dpa_basis') == 'school_pending' and user.get('dpa_version') == DPA_VERSION:
        user['dpa_basis'] = 'school_confirmed'
        user['dpa_confirmed_by_name'] = name
        user['dpa_confirmed_by_role'] = role
        user['dpa_confirmed_at'] = now
        user['dpa_signer_school'] = school
        db_layer.put_user(user['email'], user)
        db_layer.confirm_dpa_signature(user['id'], DPA_VERSION, name, role, now)
    db_layer.delete_dpa_confirmation(row['token_hash'])
    logger.info("DPA %s confirmed by principal for user %s (%s)", DPA_VERSION, row['user_id'], row['kind'])
    return jsonify({'success': True})


def cleanup_dpa_records(now: datetime | None = None) -> None:
    """Drop expired confirmation links and signatures kept past their 3 years."""
    now = now or datetime.now(timezone.utc)
    db_layer.delete_expired_dpa_confirmations(now.isoformat())
    db_layer.delete_expired_dpa_signatures((now - timedelta(days=DPA_RETENTION_DAYS)).isoformat())


@app.route('/api/terms/accept', methods=['POST'])
@login_required
async def api_terms_accept():
    """Record active consent to the current terms version (see TERMS_VERSION)."""
    data = await request.get_json() or {}
    if data.get('accepted') is not True or data.get('version') != TERMS_VERSION:
        return jsonify({'success': False, 'message': 'backend.invalidRequest'}), 400
    stored = db_layer.get_user_by_email(request.user['email'])  # type: ignore
    if not stored:
        return jsonify({'success': False}), 404
    stored['terms_version'] = TERMS_VERSION
    stored['terms_accepted_at'] = datetime.now(timezone.utc).isoformat()
    db_layer.put_user(stored['email'], stored)
    return jsonify({'success': True})


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

    if data.get('terms') is not True:
        return jsonify({'success': False, 'message': 'auth.acceptTerms'}), 400

    return await _registration_response(register_user(username, email, password))


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

    if data.get('terms') is not True:
        return jsonify({'success': False, 'message': 'auth.acceptTerms'}), 400

    return await _registration_response(register_org_admin(org_name, username, email, password))


async def _registration_response(result: dict):
    """Answer a registration. With mail configured the new account starts
    unconfirmed: a code goes to the address, and typing it in (same step as
    the email login code) confirms the address and signs the account in."""
    dek = result.pop('_dek', None)
    if not result['success']:
        return jsonify(result), 400
    user = db_layer.get_user_by_id(result['user_id'])
    if user and user.get('email_verified') is False:
        pending_id = create_pending_login(user, dek, False, False, channel='email', purpose='verify')
        if await _send_pending_email_code(pending_id):
            result['verify'] = {
                'pending_id': pending_id,
                'expires_in': REGISTER_VERIFY_TTL_SECONDS,
                'resend_in': LOGIN_EMAIL_RESEND_SECONDS,
            }
        else:
            # Account stays unconfirmed; the first sign-in mails a new code.
            pending_logins.pop(pending_id, None)
    return jsonify(result), 200


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
    # Paired account, phone not at hand: second factor by email instead.
    email_code = data.get('second_factor') == 'email'

    if not email or not password:
        return jsonify({'success': False, 'message': 'backend.fillAllFields'}), 400
    if email_code and not smtp_is_configured():
        return jsonify({'success': False, 'message': 'backend.smtpNotConfigured'}), 400

    result = login_user(email, password, force=force, long_session=long_session, email_code=email_code)

    if result.get('code') == 'session_exists':
        # 409 Conflict: client must confirm before we kill the other session.
        return jsonify(result), 409

    if result.get('code') == 'device_code_required':
        # Password was right; the paired phone now shows the one-time code.
        return jsonify(result), 202

    if result.get('code') == 'email_code_required':
        if not await _send_pending_email_code(result['pending_id']):
            pending_logins.pop(result['pending_id'], None)
            return jsonify({'success': False, 'message': 'backend.emailCodeSendFailed'}), 502
        result['resend_in'] = LOGIN_EMAIL_RESEND_SECONDS
        return jsonify(result), 202

    if result['success']:
        return await _login_response(result, long_session)

    return jsonify(result), 401


async def _send_pending_email_code(pending_id: str) -> bool:
    """Mail the pending login's code to the account address. False if sending failed."""
    pending = pending_logins[pending_id]
    user = db_layer.get_user_by_email(pending['email']) or {}
    try:
        if pending.get('purpose') == 'verify':
            await send_verify_email(pending['email'], user.get('username', ''), pending['code'])
        else:
            await send_login_code_email(pending['email'], user.get('username', ''), pending['code'],
                                        pending['user_agent'], pending['ip'])
    except Exception as e:
        logger.warning("Failed to send login code to %s: %s", _scrub_email(pending['email']), e)
        return False
    pending['sends'] += 1
    pending['sent_ts'] = time.time()
    logger.info("Login code sent by email for user %s", pending['user_id'])
    return True


@app.route('/api/login/resend-code', methods=['POST'])
@rate_limit('login_code')
async def api_login_resend_code():
    """Send a fresh email code for a pending login (at most once a minute).
    The old code stops working; wrong attempts keep counting."""
    data = await request.get_json() or {}
    pending_id = str(data.get('pending_id', ''))
    _purge_pending_logins()
    pending = pending_logins.get(pending_id)
    if not pending or pending.get('channel') != 'email':
        return jsonify({'success': False, 'message': 'backend.loginCodeExpired', 'code': 'expired'}), 410
    wait = int(pending['sent_ts'] + LOGIN_EMAIL_RESEND_SECONDS - time.time())
    if wait > 0:
        return jsonify({'success': False, 'message': 'backend.emailCodeResendWait',
                        'message_params': {'seconds': wait}, 'resend_in': wait}), 429
    if pending['sends'] >= LOGIN_EMAIL_MAX_SENDS:
        return jsonify({'success': False, 'message': 'backend.emailCodeResendLimit'}), 429
    ttl = _pending_ttl(pending['channel'], pending.get('purpose', 'login'))
    pending['code'] = f"{secrets.randbelow(10 ** 6):06d}"
    pending['expires_ts'] = time.time() + ttl
    if not await _send_pending_email_code(pending_id):
        return jsonify({'success': False, 'message': 'backend.emailCodeSendFailed'}), 502
    return jsonify({'success': True, 'message': 'backend.emailCodeResent',
                    'expires_in': ttl, 'resend_in': LOGIN_EMAIL_RESEND_SECONDS})


async def _login_response(result: dict, long_session: bool):
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


@app.route('/api/login/start', methods=['POST'])
@rate_limit('login')
async def api_login_start():
    """Email-first login. Accounts with a paired phone continue passwordless
    (phone code); everybody else — including unknown emails, so the answer
    doesn't reveal whether an account exists — continues with the password."""
    data = await request.get_json() or {}
    email = str(data.get('email', '')).strip().lower()
    force = bool(data.get('force', False))
    long_session = str(data.get('client', '')).lower() in ('app', 'android', 'mobile')
    if not email:
        return jsonify({'success': False, 'message': 'backend.fillAllFields'}), 400

    user = db_layer.get_user_by_email(email)
    device = (user or {}).get('device')
    locked_until = (user or {}).get('locked_until_ts', 0)
    if not device or passwordless_locked(user['id']) or (locked_until and time.time() < locked_until):
        return jsonify({'success': True, 'next': 'password'})

    if not force and _list_active_sessions_for_user(user['id'], include_device=False):
        return jsonify({'success': False, 'message': 'backend.sessionAlreadyActive', 'code': 'session_exists'}), 409

    pending_id = create_pending_login(user, None, long_session, force)
    return jsonify({
        'success': False,
        'next': 'device_code',
        'message': 'backend.deviceCodeRequired',
        'code': 'device_code_required',
        'pending_id': pending_id,
        'expires_in': LOGIN_CODE_TTL_SECONDS,
        'device_name': device.get('name') or '',
    }), 202


@app.route('/api/login/verify-code', methods=['POST'])
@rate_limit('login_code')
async def api_login_verify_code():
    """Second login step for accounts with a paired phone: the code the phone shows."""
    data = await request.get_json() or {}
    pending_id = str(data.get('pending_id', ''))
    code = ''.join(ch for ch in str(data.get('code', '')) if ch.isdigit())

    _purge_pending_logins()
    pending = pending_logins.get(pending_id)
    if not pending:
        return jsonify({'success': False, 'message': 'backend.loginCodeExpired', 'code': 'expired'}), 410
    if pending['denied']:
        pending_logins.pop(pending_id, None)
        return jsonify({'success': False, 'message': 'backend.loginDenied', 'code': 'denied'}), 403

    # A passwordless pending has no data key until the phone attached it — the
    # code isn't shown anywhere before that, so any guess counts as wrong.
    if pending['dek'] is None or not secrets.compare_digest(code, pending['code']):
        pending['attempts'] += 1
        if pending['passwordless']:
            passwordless_failures[pending['user_id']].append(time.time())
        remaining = LOGIN_CODE_MAX_ATTEMPTS - pending['attempts']
        if remaining <= 0:
            pending_logins.pop(pending_id, None)
            return jsonify({'success': False, 'message': 'backend.loginCodeTooManyAttempts', 'code': 'expired'}), 410
        return jsonify({'success': False, 'message': 'backend.loginCodeInvalid',
                        'message_params': {'count': remaining}, 'attempts_left': remaining}), 401

    pending_logins.pop(pending_id, None)
    user = db_layer.get_user_by_email(pending['email'])
    if not user or user['id'] != pending['user_id']:
        return jsonify({'success': False, 'message': 'backend.loginCodeExpired', 'code': 'expired'}), 410
    if pending['channel'] == 'email' and user.get('email_verified') is False:
        # The code came through the mailbox — that's the confirmation.
        user['email_verified'] = True
        db_layer.put_user(user['email'], user)
        logger.info("Email confirmed for user %s", user['id'])
    result = finish_login(user, pending['dek'], pending['long_session'], pending['force'])
    return await _login_response(result, pending['long_session'])


@app.route('/api/login/device-lost', methods=['POST'])
@rate_limit('password_reset')
async def api_login_device_lost():
    """Lost phone: password + recovery key remove the pairing so a normal
    password login works again."""
    data = await request.get_json() or {}
    email = str(data.get('email', '')).strip().lower()
    password = str(data.get('password', ''))
    recovery_key = str(data.get('recovery_key', '')).strip()
    if not email or not password or not recovery_key:
        return jsonify({'success': False, 'message': 'backend.fillAllFields'}), 400

    user = db_layer.get_user_by_email(email)
    password_ok = verify_password(user['password_hash'] if user else "00" * 32 + ":" + "00" * 32, password)
    key_ok = bool(user and user.get('recovery_key_hash')
                  and verify_recovery_key(user['recovery_key_hash'], recovery_key))
    if not (user and password_ok and key_ok):
        return jsonify({'success': False, 'message': 'backend.deviceLostInvalid'}), 400

    had_device = bool(user.get('device'))
    # Kill the lost phone's session first — unpair_device would otherwise turn
    # it into an ordinary session that keeps working.
    _terminate_user_sessions(user['id'], only_device=True)
    unpair_device(user)
    logger.info("Paired phone removed via recovery key for user %s (had device: %s)", user['id'], had_device)
    return jsonify({'success': True, 'message': 'backend.deviceUnpaired'})


@app.route('/api/device/status', methods=['GET'])
@login_required
async def api_device_status():
    user = db_layer.get_user_by_email(request.user['email'])  # type: ignore
    device = (user or {}).get('device')
    session = _session_for_request() or {}
    return jsonify({
        'success': True,
        'paired': bool(device),
        'device_id': device['id'] if device and session.get('device') else None,
        'device_name': device.get('name') if device else None,
        'paired_at': device.get('paired_at') if device else None,
        'this_device': bool(device and session.get('device')),
        'email': request.user['email'],  # type: ignore
    })


@app.route('/api/device/pair', methods=['POST'])
@rate_limit('share_manage')
@login_required
async def api_device_pair():
    """Pair the calling app as the account's phone. Replaces an earlier pairing
    (getting here already required that phone's code)."""
    token = get_token_from_request()
    dek = encryption_keys.get(token)
    if not dek:
        return jsonify({'success': False, 'message': 'backend.sessionExpired', 'requireRelogin': True}), 401
    data = await request.get_json() or {}
    secret = _decode_device_secret(data.get('device_secret'))
    if not secret:
        return jsonify({'success': False, 'message': 'backend.invalidRequest'}), 400

    user = db_layer.get_user_by_email(request.user['email'])  # type: ignore
    if not user:
        return jsonify({'success': False, 'message': 'backend.error'}), 500
    # Drop the previous phone's session, then mark this one as the device session.
    _terminate_user_sessions(user['id'], only_device=True)
    device = pair_device(user, secret, str(data.get('device_name', '')), dek)
    session = db_layer.get_session(token)
    if session:
        session['device'] = True
        session['long_session'] = True
        session['expires_at'] = (datetime.now() + timedelta(days=180)).isoformat()
        db_layer.put_session(token, session)
    logger.info("Phone paired for user %s", user['id'])
    return jsonify({'success': True, 'device_id': device['id'], 'device_name': device['name']})


@app.route('/api/device/unpair', methods=['POST'])
@rate_limit('login')
@login_required
async def api_device_unpair():
    """Remove the pairing (from the phone or the web). Requires the password."""
    data = await request.get_json() or {}
    user = db_layer.get_user_by_email(request.user['email'])  # type: ignore
    if not user or not verify_password(user['password_hash'], str(data.get('password', ''))):
        return jsonify({'success': False, 'message': 'backend.invalidPassword'}), 403
    unpair_device(user)
    return jsonify({'success': True, 'message': 'backend.deviceUnpaired'})


@app.route('/api/device/unlock', methods=['POST'])
@rate_limit('device_unlock')
async def api_device_unlock():
    """Silent re-login of the paired phone, e.g. after a server restart wiped
    the in-memory data keys. Proves possession of the device secret."""
    data = await request.get_json() or {}
    email = str(data.get('email', '')).strip().lower()
    device_id = str(data.get('device_id', ''))
    secret = _decode_device_secret(data.get('device_secret'))
    user = db_layer.get_user_by_email(email) if email else None
    device = (user or {}).get('device')
    dek = _unwrap_device_dek(user, secret) if device and secrets.compare_digest(device_id, device.get('id', '')) else None
    if not dek:
        # 'not_paired' tells the app to drop its local pairing and show the login.
        return jsonify({'success': False, 'message': 'backend.deviceNotPaired', 'code': 'not_paired'}), 403

    _terminate_user_sessions(user['id'], only_device=True)
    token = _create_session(user['id'], dek, long_session=True, device=True)
    device['last_seen'] = datetime.now().isoformat()
    db_layer.put_user(user['email'], user)
    return await _login_response({
        'success': True,
        'message': 'backend.loginSuccess',
        'token': token,
        'needs_recovery_key': not user.get('recovery_key_hash'),
        'device_paired': True,
        'user': {'id': user['id'], 'username': user['username'], 'email': user['email']}
    }, long_session=True)


def _device_session_user():
    """(user, error_response) for endpoints only the paired phone may call."""
    session = _session_for_request() or {}
    user = db_layer.get_user_by_email(request.user['email'])  # type: ignore
    if not user or not user.get('device') or not session.get('device'):
        return None, (jsonify({'success': False, 'message': 'backend.deviceNotPaired', 'code': 'not_paired'}), 403)
    return user, None


@app.route('/api/device/login-requests', methods=['GET'])
@login_required
async def api_device_login_requests():
    """Pending browser logins waiting for the code — polled by the phone."""
    user, err = _device_session_user()
    if err:
        return err
    _purge_pending_logins()
    now_ts = time.time()
    items = [{
        'id': pid,
        # Passwordless: the code only appears once this phone supplied the key.
        'code': e['code'] if e['dek'] is not None else '',
        'needs_key': e['dek'] is None,
        'expires_in': int(e['expires_ts'] - now_ts),
        'created_at': datetime.fromtimestamp(e['created_ts']).isoformat(timespec='seconds'),
        'ip': e['ip'],
        'client': e['user_agent'],
    } for pid, e in sorted(pending_logins.items(), key=lambda kv: kv[1]['created_ts'])
        if e['user_id'] == user['id'] and not e['denied'] and e.get('channel') != 'email']
    return jsonify({'success': True, 'requests': items})


@app.route('/api/device/login-requests/<pending_id>/attach', methods=['POST'])
@rate_limit('device_unlock')
@login_required
async def api_device_attach_key(pending_id):
    """Passwordless login: the phone proves its secret, the server unwraps the
    data key for exactly this pending sign-in (the browser still needs the code)."""
    user, err = _device_session_user()
    if err:
        return err
    pending = pending_logins.get(pending_id)
    if not pending or pending['user_id'] != user['id'] or pending['denied']:
        return jsonify({'success': False, 'message': 'backend.loginCodeExpired', 'code': 'expired'}), 410
    data = await request.get_json() or {}
    dek = _unwrap_device_dek(user, _decode_device_secret(data.get('device_secret')))
    if not dek:
        return jsonify({'success': False, 'message': 'backend.deviceNotPaired', 'code': 'not_paired'}), 403
    pending['dek'] = dek
    return jsonify({'success': True, 'code': pending['code']})


@app.route('/api/device/login-requests/<pending_id>/deny', methods=['POST'])
@login_required
async def api_device_deny_login(pending_id):
    user, err = _device_session_user()
    if err:
        return err
    pending = pending_logins.get(pending_id)
    if pending and pending['user_id'] == user['id']:
        pending['denied'] = True
        logger.info("Browser login denied from paired phone for user %s", user['id'])
    return jsonify({'success': True})


# ============ ANNOUNCEMENTS ============
# Developer announcements, shown as dialogs after login (web) or when the app
# is opened — several are shown one after another, oldest first. Created in the server
# console (`python manage.py` → announce); it writes data/announcement.json, which is re-read
# whenever the file changes (no restart). A user sees each announcement until
# they press "OK" on it, on any device. Clients that don't know announcements
# (old app versions) never confirm, so the new version still shows them.

ANNOUNCEMENT_PATH = DATA_DIR / "announcement.json"
ANNOUNCEMENT_LEVELS = ('info', 'alert', 'danger')
ANNOUNCEMENT_SEEN_MAX = 200   # remembered confirmations per user
_announcement_cache = {'mtime': None, 'data': []}


def _announcement_live(ann) -> bool:
    if not isinstance(ann, dict) or not ann.get('active') or not ann.get('id') or not ann.get('message'):
        return False
    if ann.get('level') not in ANNOUNCEMENT_LEVELS:
        return False
    if ann.get('until'):
        try:
            return datetime.now() <= datetime.fromisoformat(ann['until'])
        except ValueError:
            return False
    return True


def current_announcements() -> list:
    """All live announcements, oldest first (missing/invalid file → none)."""
    try:
        mtime = ANNOUNCEMENT_PATH.stat().st_mtime
    except FileNotFoundError:
        return []
    if _announcement_cache['mtime'] != mtime:
        try:
            with open(ANNOUNCEMENT_PATH, 'r', encoding='utf-8') as f:
                raw = json.load(f)
            _announcement_cache['data'] = raw.get('announcements', []) if isinstance(raw, dict) else []
        except (OSError, json.JSONDecodeError) as e:
            logger.warning("announcement.json unreadable: %s", e)
            _announcement_cache['data'] = []
        _announcement_cache['mtime'] = mtime
    return [a for a in _announcement_cache['data'] if _announcement_live(a)]


@app.route('/api/announcement', methods=['GET'])
@login_required
async def api_announcement():
    """Live announcements this user hasn't confirmed yet, oldest first."""
    user = db_layer.get_user_by_email(request.user['email'])  # type: ignore
    seen = set((user or {}).get('announcements_seen') or [])
    return jsonify({'success': True, 'announcements': [{
        'id': a['id'],
        'level': a['level'],
        'title': a.get('title') or '',
        'message': a['message'],
        'title_en': a.get('title_en') or '',
        'message_en': a.get('message_en') or '',
    } for a in current_announcements() if a['id'] not in seen]})


@app.route('/api/announcement/ack', methods=['POST'])
@login_required
async def api_announcement_ack():
    """"OK" pressed on one announcement: don't show it to this user again (any device)."""
    data = await request.get_json() or {}
    ann_id = str(data.get('id', ''))[:100]
    user = db_layer.get_user_by_email(request.user['email'])  # type: ignore
    if not ann_id or not user:
        return jsonify({'success': True})
    seen = user.get('announcements_seen') or []
    if ann_id not in seen:
        user['announcements_seen'] = (seen + [ann_id])[-ANNOUNCEMENT_SEEN_MAX:]
        db_layer.put_user(user['email'], user)
    return jsonify({'success': True})


SCHOOL_NAME_MAX = 120
SCHOOL_SUGGESTIONS_MAX = 8


def _normalize_school(name) -> str:
    return ' '.join(str(name or '').split())[:SCHOOL_NAME_MAX]


def _school_matches(name: str, query: str) -> int | None:
    """Rank of *name* for the typed *query* (lower = better), None if no match.

    Every typed word has to start a word of the school name, so "htl tr"
    finds "HTL Traun"; a plain substring match ranks last.
    """
    n, q = name.casefold(), query.casefold()
    if n.startswith(q):
        return 0
    words = n.split()
    if all(any(w.startswith(t) for w in words) for t in q.split()):
        return 1
    return 2 if q in n else None


@app.route('/api/schools', methods=['GET'])
@login_required
async def api_schools():
    """Schools other teachers already entered, matching what the user is typing."""
    query = _normalize_school(request.args.get('q', ''))
    if len(query) < 2:
        return jsonify({'success': True, 'schools': []})
    hits = []
    for name, count in db_layer.list_schools():
        rank = _school_matches(name, query)
        if rank is not None:
            hits.append((rank, -count, name.casefold(), name))
    hits.sort()
    return jsonify({'success': True, 'schools': [h[3] for h in hits[:SCHOOL_SUGGESTIONS_MAX]]})


@app.route('/api/profile/school', methods=['POST'])
@login_required
async def api_profile_school():
    """Set the (mandatory) school of the account.

    Stored in plain text on the account — unlike appData — so colleagues
    get it suggested. Adopts the existing spelling when the school is
    already known (case-insensitive), so "htl traun" joins "HTL Traun".
    """
    data = await request.get_json() or {}
    school = _normalize_school(data.get('school'))
    if not school:
        return jsonify({'success': False, 'message': 'profile.schoolRequired'}), 400
    for name, _count in db_layer.list_schools():
        if name.casefold() == school.casefold():
            school = name
            break
    user = db_layer.get_user_by_email(request.user['email'])  # type: ignore
    if not user:
        return jsonify({'success': False}), 404
    user['school'] = school
    db_layer.put_user(user['email'], user)
    return jsonify({'success': True, 'school': school})


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
        new_dek = derive_encryption_key(new_password, new_encryption_salt, KDF_ITERATIONS_CURRENT)

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
        user['kdf_iterations'] = KDF_ITERATIONS_CURRENT
        user['recovery_salt'] = new_recovery_salt.hex()
        user['encrypted_dek'] = new_encrypted_dek
        # The phone's wrapped copy is of the old DEK — the pairing can't survive.
        user.pop('device', None)
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
        new_dek = derive_encryption_key(new_password, new_encryption_salt, KDF_ITERATIONS_CURRENT)

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
        user['kdf_iterations'] = KDF_ITERATIONS_CURRENT
        user['recovery_key_hash'] = hash_recovery_key(new_recovery_key)
        user['recovery_salt'] = new_recovery_salt.hex()
        user['encrypted_dek'] = new_encrypted_dek
        user.pop('device', None)
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
        # One transaction: gradebook, sessions, org membership/roster, shares,
        # handovers, reset tokens and the user record.
        try:
            tokens = db_layer.delete_account(user_email)
        except ValueError:
            return jsonify({'success': False, 'message': 'backend.orgAdminCannotLeave'}), 400
        for tok in tokens:
            clear_session_cache(tok)
        # Sessions of this user that are not in the DB anymore but still hold keys
        _terminate_user_sessions(user_id)

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

        carry_over_student_fields(user_id, data, encryption_key)

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
    # An org whose school DPA is not confirmed yet takes no new members.
    if not _org_dpa_confirmed(org['id']):
        return jsonify({'success': False, 'message': 'backend.orgDpaPending'}), 403

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
            'join_code': org['join_code'] if membership['role'] == 'admin' else None,
            'dpa_confirmed': _org_dpa_confirmed(org['id'])
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
    if not _org_dpa_confirmed(org_id):
        return jsonify({'success': False, 'message': 'backend.orgDpaPending'}), 403

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
        db_layer.delete_handover(handover_token)
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

    # The snapshot has been imported; keep nothing of it on the server.
    db_layer.delete_handover(handover_token)

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

    db_layer.delete_handover(handover_token)
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
