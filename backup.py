"""backup.py - encrypted daily SQLite backups for EduGrade.

* The copy is taken with SQLite's online backup API (consistent even while the
  server writes), serialised in memory and encrypted with AES-256-GCM. No
  plaintext copy ever touches the disk.
* The key comes from the BACKUP_KEY environment variable (never stored in the
  volume or the repo). Any string works; it is stretched with scrypt and a
  random per-file salt. Without BACKUP_KEY no backup is made.
* Files live in BACKUP_DIR (default ./backups, /app/backups in Docker) and are
  deleted after RETENTION_DAYS (30), which the DPA / privacy policy promise.

File layout: MAGIC | salt(16) | nonce(12) | AES-GCM(ciphertext + tag),
MAGIC and salt are authenticated as associated data.

This module deliberately does not import db.py (it must work in a standalone
restore with the server stopped).
"""
from __future__ import annotations

import logging
import os
import re
import secrets
import sqlite3
import hashlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

logger = logging.getLogger(__name__)

MAGIC = b"EGBK1"
SALT_LEN = 16
NONCE_LEN = 12
RETENTION_DAYS = 30
SUFFIX = ".db.enc"
_NAME_RE = re.compile(r"^edugrade-(\d{4}-\d{2}-\d{2})_(\d{6})" + re.escape(SUFFIX) + r"$")

DATA_DIR = Path(__file__).parent / "data"
DB_FILE = DATA_DIR / "edugrade.db"


def backup_dir() -> Path:
    return Path(os.environ.get("BACKUP_DIR") or (Path(__file__).parent / "backups"))


def get_backup_key() -> str | None:
    key = os.environ.get("BACKUP_KEY", "").strip()
    return key or None


class BackupError(Exception):
    """Wrong key, damaged file or not an EduGrade backup."""


def _derive_key(secret: str, salt: bytes) -> bytes:
    return hashlib.scrypt(secret.encode("utf-8"), salt=salt, n=2 ** 15, r=8, p=1,
                          maxmem=64 * 1024 * 1024, dklen=32)


def encrypt_bytes(plain: bytes, secret: str) -> bytes:
    salt = secrets.token_bytes(SALT_LEN)
    nonce = secrets.token_bytes(NONCE_LEN)
    ct = AESGCM(_derive_key(secret, salt)).encrypt(nonce, plain, MAGIC + salt)
    return MAGIC + salt + nonce + ct


def decrypt_bytes(blob: bytes, secret: str) -> bytes:
    head = len(MAGIC) + SALT_LEN + NONCE_LEN
    if len(blob) < head + 16 or not blob.startswith(MAGIC):
        raise BackupError("not an EduGrade backup file")
    salt = blob[len(MAGIC):len(MAGIC) + SALT_LEN]
    nonce = blob[len(MAGIC) + SALT_LEN:head]
    try:
        return AESGCM(_derive_key(secret, salt)).decrypt(nonce, blob[head:], MAGIC + salt)
    except InvalidTag:
        raise BackupError("wrong BACKUP_KEY or damaged file") from None


def _snapshot(src_db: Path) -> bytes:
    """Consistent copy of the live database as raw SQLite bytes (in memory)."""
    src = sqlite3.connect(f"file:{src_db}?mode=ro", uri=True)
    try:
        mem = sqlite3.connect(":memory:")
        try:
            src.backup(mem)
            return mem.serialize()
        finally:
            mem.close()
    finally:
        src.close()


def _file_stamp(name: str) -> datetime | None:
    m = _NAME_RE.match(name)
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1) + m.group(2), "%Y-%m-%d%H%M%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def list_backups(directory: Path | None = None) -> list[Path]:
    directory = directory or backup_dir()
    if not directory.is_dir():
        return []
    return sorted(p for p in directory.iterdir() if _NAME_RE.match(p.name))


def has_backup_for_day(day: str, directory: Path | None = None) -> bool:
    """day = 'YYYY-MM-DD' (UTC)."""
    return any(p.name.startswith(f"edugrade-{day}_") for p in list_backups(directory))


def create_backup(secret: str | None = None, src_db: Path | None = None,
                  directory: Path | None = None, now: datetime | None = None) -> Path:
    """Write one encrypted backup file and return its path."""
    secret = secret or get_backup_key()
    if not secret:
        raise BackupError("BACKUP_KEY is not set")
    src_db = Path(src_db or DB_FILE)
    directory = directory or backup_dir()
    now = now or datetime.now(timezone.utc)
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / f"edugrade-{now:%Y-%m-%d_%H%M%S}{SUFFIX}"
    tmp = target.with_name(target.name + ".tmp")
    tmp.write_bytes(encrypt_bytes(_snapshot(src_db), secret))
    os.chmod(tmp, 0o600)
    os.replace(tmp, target)
    return target


def prune_backups(directory: Path | None = None, now: datetime | None = None,
                  days: int = RETENTION_DAYS) -> list[Path]:
    """Delete backups older than *days*; returns the removed files."""
    directory = directory or backup_dir()
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=days)
    removed = []
    for p in list_backups(directory):
        stamp = _file_stamp(p.name)
        if stamp and stamp < cutoff:
            p.unlink(missing_ok=True)
            removed.append(p)
    for p in directory.glob("*.tmp") if directory.is_dir() else []:
        if p.name.startswith("edugrade-"):
            p.unlink(missing_ok=True)  # leftovers of an interrupted run
    return removed


def run_daily_backup(now: datetime | None = None) -> Path | None:
    """Daily job: one backup per UTC day, then prune. Returns the new file or
    None (no key, already done today, or failure; all logged, never raised)."""
    now = now or datetime.now(timezone.utc)
    secret = get_backup_key()
    if not secret:
        logger.warning("BACKUP_KEY is not set - no database backup was made")
        return None
    try:
        created = None
        if not has_backup_for_day(f"{now:%Y-%m-%d}"):
            created = create_backup(secret, now=now)
            logger.info("Database backup written: %s", created.name)
        pruned = prune_backups(now=now)
        if pruned:
            logger.info("Pruned %d backup(s) older than %d days", len(pruned), RETENTION_DAYS)
        return created
    except Exception as e:
        logger.error("Database backup failed: %s", type(e).__name__)
        return None


def restore_backup(backup_file: Path, secret: str | None = None, target_db: Path | None = None) -> Path | None:
    """Decrypt *backup_file* and put it in place as the live database.

    The server MUST be stopped. The existing database is kept next to it as
    ``edugrade.db.before-restore-<timestamp>``; stale -wal/-shm files are
    removed. Returns the path of that safety copy (None if there was no DB).
    The restored file is integrity-checked before it replaces anything."""
    secret = secret or get_backup_key()
    if not secret:
        raise BackupError("BACKUP_KEY is not set")
    target_db = Path(target_db or DB_FILE)
    plain = decrypt_bytes(Path(backup_file).read_bytes(), secret)
    staging = target_db.with_name(target_db.name + ".restore-tmp")
    staging.write_bytes(plain)
    try:
        check = sqlite3.connect(str(staging))
        try:
            ok = check.execute("PRAGMA integrity_check").fetchone()[0]
        finally:
            check.close()
        if ok != "ok":
            raise BackupError("restored database failed the integrity check")
    except sqlite3.DatabaseError as e:
        staging.unlink(missing_ok=True)
        raise BackupError(f"restored file is not a valid database ({e})") from None
    except BackupError:
        staging.unlink(missing_ok=True)
        raise
    safety = None
    if target_db.exists():
        safety = target_db.with_name(f"{target_db.name}.before-restore-{datetime.now():%Y%m%d-%H%M%S}")
        os.replace(target_db, safety)
    for ext in ("-wal", "-shm"):
        Path(str(target_db) + ext).unlink(missing_ok=True)
    os.replace(staging, target_db)
    return safety
