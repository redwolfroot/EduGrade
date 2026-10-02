"""db.py — Synchronous SQLite storage layer for EduGrade.

Replaces the single-JSON-file backend (data/edugrade.json).  All functions are
intentionally synchronous (no async/await) so existing call sites in app.py
need no changes.  Encryption is the caller's responsibility; this module stores
and returns opaque ciphertext strings and plain dicts as JSON.

Connection is shared at module level with check_same_thread=False and WAL mode.
A threading.Lock guards every write so the module is safe under Quart's
thread-pool executor.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# DB path — mirrors app.py's DATA_DIR resolution (Path(__file__).parent / "data")
# ---------------------------------------------------------------------------
DATA_DIR: Path = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)
DB_FILE: Path = DATA_DIR / "edugrade.db"

# ---------------------------------------------------------------------------
# Module-level connection + write lock
# ---------------------------------------------------------------------------
_conn: sqlite3.Connection = sqlite3.connect(
    str(DB_FILE),
    check_same_thread=False,
    isolation_level=None,   # autocommit — we manage transactions ourselves
)
_conn.row_factory = sqlite3.Row
_conn.execute("PRAGMA journal_mode=WAL;")
_conn.execute("PRAGMA synchronous=NORMAL;")
_conn.execute("PRAGMA foreign_keys=ON;")

_write_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _dumps(obj: Any) -> str:
    """Serialise a dict to a compact JSON string."""
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def _loads(text: str | None) -> dict:
    """Deserialise a JSON string; returns {} on None/empty."""
    if not text:
        return {}
    return json.loads(text)


def _execute_write(sql: str, params: tuple = ()) -> sqlite3.Cursor:
    """Execute a write statement under the write lock."""
    with _write_lock:
        return _conn.execute(sql, params)


def _executemany_write(sql: str, param_list: list[tuple]) -> None:
    """Execute a batch write under the write lock."""
    with _write_lock:
        _conn.executemany(sql, param_list)


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

_CREATE_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS users (
        email   TEXT PRIMARY KEY,
        id      TEXT NOT NULL UNIQUE,
        doc     TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_users_id ON users(id)",
    """
    CREATE TABLE IF NOT EXISTS sessions (
        token       TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL,
        expires_at  TEXT NOT NULL,
        doc         TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)",
    """
    CREATE TABLE IF NOT EXISTS user_meta (
        user_id     TEXT PRIMARY KEY,
        version     INTEGER DEFAULT 2,
        encrypted   INTEGER DEFAULT 1,
        meta_ct     TEXT,
        legacy_ct   TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS user_classes (
        user_id   TEXT NOT NULL,
        class_id  TEXT NOT NULL,
        ct        TEXT NOT NULL,
        PRIMARY KEY (user_id, class_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS class_shares (
        token          TEXT PRIMARY KEY,
        class_id       TEXT,
        active         INTEGER,
        expires_at     TEXT,
        encrypted_data TEXT,
        doc            TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
        token       TEXT PRIMARY KEY,
        user_id     TEXT,
        expires_at  TEXT,
        doc         TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS orgs (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        join_code     TEXT NOT NULL UNIQUE,
        admin_user_id TEXT NOT NULL,
        created_at    TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS org_members (
        org_id       TEXT NOT NULL,
        user_id      TEXT NOT NULL UNIQUE,
        role         TEXT NOT NULL DEFAULT 'teacher',
        status       TEXT NOT NULL DEFAULT 'pending',
        requested_at TEXT NOT NULL,
        approved_at  TEXT,
        PRIMARY KEY (org_id, user_id)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_org_members_org_status ON org_members(org_id, status)",
    """
    CREATE TABLE IF NOT EXISTS org_roster (
        org_id       TEXT NOT NULL,
        user_id      TEXT NOT NULL,
        class_id     TEXT NOT NULL,
        student_name TEXT NOT NULL,
        class_name   TEXT NOT NULL,
        teacher_name TEXT,
        updated_at   TEXT NOT NULL,
        PRIMARY KEY (org_id, user_id, class_id, student_name)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_org_roster_org ON org_roster(org_id)",
    """
    CREATE TABLE IF NOT EXISTS class_handovers (
        token          TEXT PRIMARY KEY,
        org_id         TEXT NOT NULL,
        from_user_id   TEXT NOT NULL,
        to_user_id     TEXT NOT NULL,
        class_id       TEXT NOT NULL,
        status         TEXT NOT NULL DEFAULT 'pending',
        encrypted_data TEXT,
        created_at     TEXT NOT NULL,
        expires_at     TEXT NOT NULL,
        doc            TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_class_handovers_to_status ON class_handovers(to_user_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_class_handovers_from ON class_handovers(from_user_id)",
    # DPA (AVV) signature archive. Deliberately has no foreign key to users and
    # stores no e-mail address: the proof of signing outlives the account and
    # is kept for 3 years after the contract ended (see delete_account).
    """
    CREATE TABLE IF NOT EXISTS dpa_signatures (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       TEXT NOT NULL,
        version       TEXT NOT NULL,
        accepted_at   TEXT NOT NULL,
        signer_name   TEXT NOT NULL,
        signer_school TEXT,
        basis         TEXT NOT NULL,
        org_id        TEXT,
        confirmed_by_name TEXT,
        confirmed_by_role TEXT,
        confirmed_at  TEXT,
        text_sha256   TEXT NOT NULL,
        contract_ended_at TEXT
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_dpa_sig_user ON dpa_signatures(user_id)",
    # School-level DPA of an org. No row (or an outdated version) = the org is
    # "pending": existing members keep working, nobody new can join.
    """
    CREATE TABLE IF NOT EXISTS org_dpa (
        org_id            TEXT PRIMARY KEY,
        version           TEXT NOT NULL,
        school_name       TEXT,
        confirmed_by_name TEXT NOT NULL,
        confirmed_by_role TEXT NOT NULL,
        confirmed_at      TEXT NOT NULL,
        text_sha256       TEXT NOT NULL
    )
    """,
    # One-time confirmation links for the school principal (only the token
    # hash is stored). principal_email is kept only until confirmed/expired.
    """
    CREATE TABLE IF NOT EXISTS dpa_confirmations (
        token_hash      TEXT PRIMARY KEY,
        kind            TEXT NOT NULL,
        user_id         TEXT NOT NULL,
        org_id          TEXT,
        version         TEXT NOT NULL,
        principal_email TEXT,
        created_at      TEXT NOT NULL,
        expires_at      TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_dpa_conf_user ON dpa_confirmations(user_id)",
]


def init_schema() -> None:
    """Create all tables and indices if they do not exist yet.

    Safe to call multiple times (uses IF NOT EXISTS).  Called once at app
    startup before any other db.py function is used.
    """
    with _write_lock:
        with _conn:
            for stmt in _CREATE_STATEMENTS:
                _conn.execute(stmt)
    logger.info("db.py: SQLite schema ready (%s)", DB_FILE)


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

def get_user_by_email(email: str) -> dict | None:
    """Return the user dict for *email*, or None if not found."""
    row = _conn.execute(
        "SELECT doc FROM users WHERE email = ?", (email,)
    ).fetchone()
    return _loads(row["doc"]) if row else None


def get_user_by_id(user_id: str) -> dict | None:
    """Return the user dict for *user_id*, or None if not found."""
    row = _conn.execute(
        "SELECT doc FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    return _loads(row["doc"]) if row else None


def get_email_by_id(user_id: str) -> str | None:
    """Return the email address for *user_id*, or None if not found."""
    row = _conn.execute(
        "SELECT email FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    return row["email"] if row else None


def put_user(email: str, user_dict: dict) -> None:
    """Insert or replace the user record for *email*.

    Extracts the ``id`` field from *user_dict* into the indexed ``id`` column.
    """
    user_id = user_dict.get("id", "")
    _execute_write(
        "INSERT OR REPLACE INTO users (email, id, doc) VALUES (?, ?, ?)",
        (email, user_id, _dumps(user_dict)),
    )


def delete_user(email: str) -> None:
    """Delete the user record for *email* (no-op if absent)."""
    _execute_write("DELETE FROM users WHERE email = ?", (email,))


def delete_account(email: str) -> list[str]:
    """Remove a user completely: gradebook, sessions, org membership/roster and
    the user record. An org admin's org goes with them — unless other members
    are left, then ValueError (admin must hand over first, like leaving).
    Returns the deleted session tokens so the server can drop cached keys."""
    user = get_user_by_email(email)
    if not user:
        return []
    user_id = user["id"]
    membership = get_org_membership(user_id)
    if membership and membership["role"] == "admin" and membership["status"] == "approved":
        if len(list_org_members(membership["org_id"])) > 1:
            raise ValueError("org admin with other members")
    with _write_lock:
        with _conn:
            tokens = [r["token"] for r in _conn.execute(
                "SELECT token FROM sessions WHERE user_id = ?", (user_id,))]
            _conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            _conn.execute("DELETE FROM user_meta WHERE user_id = ?", (user_id,))
            _conn.execute("DELETE FROM user_classes WHERE user_id = ?", (user_id,))
            if membership and membership["role"] == "admin" and membership["status"] == "approved":
                org_id = membership["org_id"]
                _conn.execute("DELETE FROM orgs WHERE id = ?", (org_id,))
                _conn.execute("DELETE FROM org_members WHERE org_id = ?", (org_id,))
                _conn.execute("DELETE FROM org_roster WHERE org_id = ?", (org_id,))
                _conn.execute("DELETE FROM org_dpa WHERE org_id = ?", (org_id,))
                _conn.execute("DELETE FROM dpa_confirmations WHERE org_id = ?", (org_id,))
            _conn.execute("DELETE FROM org_members WHERE user_id = ?", (user_id,))
            _conn.execute("DELETE FROM org_roster WHERE user_id = ?", (user_id,))
            # The DPA proof is kept (3 years, see delete_expired_dpa_signatures);
            # only mark the contract as ended. Open confirmation links go.
            _conn.execute(
                "UPDATE dpa_signatures SET contract_ended_at = ? "
                "WHERE user_id = ? AND contract_ended_at IS NULL",
                (datetime.now(timezone.utc).isoformat(), user_id))
            _conn.execute("DELETE FROM dpa_confirmations WHERE user_id = ?", (user_id,))
            # Shares (link + PIN), handovers in either direction and reset
            # tokens must not outlive the account.
            _conn.execute(
                "DELETE FROM class_shares WHERE json_extract(doc, '$.user_id') = ?", (user_id,))
            _conn.execute(
                "DELETE FROM class_handovers WHERE from_user_id = ? OR to_user_id = ?",
                (user_id, user_id))
            _conn.execute("DELETE FROM password_reset_tokens WHERE user_id = ? OR user_id = ?",
                          (user_id, email))
            _conn.execute("DELETE FROM users WHERE email = ?", (email,))
    return tokens


def iter_users() -> list[tuple[str, dict]]:
    """Return all users as a list of (email, user_dict) pairs."""
    rows = _conn.execute("SELECT email, doc FROM users").fetchall()
    return [(row["email"], _loads(row["doc"])) for row in rows]


def count_users() -> int:
    """Return the total number of registered users.

    Used by the boot-time migration to detect an empty database.
    """
    row = _conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()
    return row["n"] if row else 0


def list_schools() -> list[tuple[str, int]]:
    """Return every school name entered in a profile with its account count.

    Names are grouped case-insensitively; the most common spelling wins.
    Sorted by count (desc), then name.
    """
    rows = _conn.execute(
        """
        SELECT TRIM(json_extract(doc, '$.school')) AS name, COUNT(*) AS n
        FROM users
        WHERE TRIM(COALESCE(json_extract(doc, '$.school'), '')) <> ''
        GROUP BY name
        """
    ).fetchall()
    groups: dict[str, list[tuple[str, int]]] = {}
    for row in rows:
        groups.setdefault(row["name"].casefold(), []).append((row["name"], row["n"]))
    schools = [
        (max(variants, key=lambda v: v[1])[0], sum(n for _, n in variants))
        for variants in groups.values()
    ]
    schools.sort(key=lambda s: (-s[1], s[0].casefold()))
    return schools


def increment_failed_login(email: str) -> int:
    """Atomically increment failed_login_count for *email* and return the new value.

    Uses SQLite's json_set/json_extract so the whole read-modify-write happens in
    one SQL statement under _write_lock, preventing lost updates under concurrency.
    Returns 0 if the user is not found.
    """
    with _write_lock:
        _conn.execute(
            """
            UPDATE users
               SET doc = json_set(
                             doc,
                             '$.failed_login_count',
                             COALESCE(json_extract(doc, '$.failed_login_count'), 0) + 1
                         )
             WHERE email = ?
            """,
            (email,),
        )
        row = _conn.execute(
            "SELECT json_extract(doc, '$.failed_login_count') AS n FROM users WHERE email = ?",
            (email,),
        ).fetchone()
    return int(row["n"]) if row and row["n"] is not None else 0


def set_lockout(email: str, locked_until_ts: int) -> None:
    """Atomically set locked_until_ts and reset failed_login_count to 0 for *email*."""
    with _write_lock:
        _conn.execute(
            """
            UPDATE users
               SET doc = json_set(
                             json_set(doc, '$.locked_until_ts', ?),
                             '$.failed_login_count', 0
                         )
             WHERE email = ?
            """,
            (locked_until_ts, email),
        )


def reset_failed_login(email: str) -> None:
    """Atomically reset failed_login_count and locked_until_ts to 0 for *email*."""
    with _write_lock:
        _conn.execute(
            """
            UPDATE users
               SET doc = json_set(
                             json_set(doc, '$.failed_login_count', 0),
                             '$.locked_until_ts', 0
                         )
             WHERE email = ?
            """,
            (email,),
        )


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------

def get_session(token: str) -> dict | None:
    """Return the session dict for *token*, or None if not found."""
    row = _conn.execute(
        "SELECT doc FROM sessions WHERE token = ?", (token,)
    ).fetchone()
    return _loads(row["doc"]) if row else None


def put_session(token: str, session_dict: dict) -> None:
    """Insert or replace a session record.

    Extracts ``user_id`` and ``expires_at`` into indexed columns.
    """
    user_id = session_dict.get("user_id", "")
    expires_at = session_dict.get("expires_at", "")
    _execute_write(
        "INSERT OR REPLACE INTO sessions (token, user_id, expires_at, doc) VALUES (?, ?, ?, ?)",
        (token, user_id, expires_at, _dumps(session_dict)),
    )


def delete_session(token: str) -> None:
    """Delete a single session by token (no-op if absent)."""
    _execute_write("DELETE FROM sessions WHERE token = ?", (token,))


def delete_sessions_for_user(user_id: str) -> None:
    """Delete all sessions belonging to *user_id*."""
    _execute_write("DELETE FROM sessions WHERE user_id = ?", (user_id,))


def delete_expired_sessions(now_iso: str) -> list[str]:
    """Delete all sessions whose ``expires_at`` is before *now_iso*.

    Returns the list of deleted tokens so the caller can purge in-memory
    caches (encryption_keys, user_data_cache).
    """
    rows = _conn.execute(
        "SELECT token FROM sessions WHERE expires_at < ?", (now_iso,)
    ).fetchall()
    tokens = [row["token"] for row in rows]
    if tokens:
        placeholders = ",".join("?" * len(tokens))
        _execute_write(
            f"DELETE FROM sessions WHERE token IN ({placeholders})", tuple(tokens)
        )
    return tokens


def iter_sessions() -> list[tuple[str, dict]]:
    """Return all sessions as a list of (token, session_dict) pairs."""
    rows = _conn.execute("SELECT token, doc FROM sessions").fetchall()
    return [(row["token"], _loads(row["doc"])) for row in rows]


# ---------------------------------------------------------------------------
# User meta / classes (v2 split layout)
#
# v2 layout stored across two tables:
#   user_meta  — version, encrypted flag, meta ciphertext, optional legacy blob
#   user_classes — one row per class (user_id, class_id, ciphertext)
#
# Legacy v1 single-blob: {"encrypted": True, "data": "<ciphertext>"}
#   stored with version=1 and the blob in legacy_ct.
# ---------------------------------------------------------------------------

def get_meta_record(user_id: str) -> dict | None:
    """Return the meta record dict for *user_id*, or None if no row exists.

    Returned dict keys: ``version``, ``encrypted``, ``meta_ct``, ``legacy_ct``.
    ``meta_ct`` and ``legacy_ct`` may be None.
    """
    row = _conn.execute(
        "SELECT version, encrypted, meta_ct, legacy_ct FROM user_meta WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    if row is None:
        return None
    return {
        "version": row["version"],
        "encrypted": bool(row["encrypted"]),
        "meta_ct": row["meta_ct"],
        "legacy_ct": row["legacy_ct"],
    }


def put_meta_ct(user_id: str, meta_ct: str) -> None:
    """Upsert the v2 meta ciphertext for *user_id*.

    Sets version=2, encrypted=1, clears legacy_ct.  Creates the row if absent.
    """
    _execute_write(
        """
        INSERT INTO user_meta (user_id, version, encrypted, meta_ct, legacy_ct)
            VALUES (?, 2, 1, ?, NULL)
        ON CONFLICT(user_id) DO UPDATE SET
            version   = 2,
            encrypted = 1,
            meta_ct   = excluded.meta_ct,
            legacy_ct = NULL
        """,
        (user_id, meta_ct),
    )


def get_legacy_ct(user_id: str) -> str | None:
    """Return the legacy v1 single-blob ciphertext for *user_id*, or None."""
    row = _conn.execute(
        "SELECT legacy_ct FROM user_meta WHERE user_id = ?", (user_id,)
    ).fetchone()
    return row["legacy_ct"] if row else None


def put_legacy_record(user_id: str, legacy_ct: str, encrypted: bool = True) -> None:
    """Store a legacy v1 single-blob record.

    When ``encrypted=True`` (default) the caller passes a ciphertext string
    (the value of the ``data`` key from the old JSON layout).  When
    ``encrypted=False`` the caller passes a plaintext JSON string — this
    preserves zero-knowledge records that the server cannot re-encrypt during
    migration because it has no user key.

    The row is written with version=1 so app.py's _ensure_v2/migrate_user_to_v2
    can detect and migrate it on the next login.
    """
    enc_flag = 1 if encrypted else 0
    _execute_write(
        """
        INSERT INTO user_meta (user_id, version, encrypted, meta_ct, legacy_ct)
            VALUES (?, 1, ?, NULL, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            version   = 1,
            encrypted = excluded.encrypted,
            meta_ct   = NULL,
            legacy_ct = excluded.legacy_ct
        """,
        (user_id, enc_flag, legacy_ct),
    )


def get_class_ct(user_id: str, class_id: str) -> str | None:
    """Return the ciphertext for a single class, or None if not found."""
    row = _conn.execute(
        "SELECT ct FROM user_classes WHERE user_id = ? AND class_id = ?",
        (user_id, str(class_id)),
    ).fetchone()
    return row["ct"] if row else None


def put_class_ct(user_id: str, class_id: str, ct: str) -> None:
    """Insert or replace the ciphertext for a single class."""
    _execute_write(
        "INSERT OR REPLACE INTO user_classes (user_id, class_id, ct) VALUES (?, ?, ?)",
        (user_id, str(class_id), ct),
    )


def delete_class(user_id: str, class_id: str) -> bool:
    """Delete a single class blob.  Returns True if a row was actually deleted."""
    cur = _execute_write(
        "DELETE FROM user_classes WHERE user_id = ? AND class_id = ?",
        (user_id, str(class_id)),
    )
    return cur.rowcount > 0


def list_class_ids(user_id: str) -> list[str]:
    """Return all class_id values stored for *user_id*."""
    rows = _conn.execute(
        "SELECT class_id FROM user_classes WHERE user_id = ?", (user_id,)
    ).fetchall()
    return [row["class_id"] for row in rows]


def delete_user_data(user_id: str) -> None:
    """Remove all user_meta and user_classes rows for *user_id* atomically."""
    with _write_lock:
        with _conn:
            _conn.execute("DELETE FROM user_meta WHERE user_id = ?", (user_id,))
            _conn.execute("DELETE FROM user_classes WHERE user_id = ?", (user_id,))


def user_data_exists(user_id: str) -> bool:
    """Return True if any user_meta or user_classes row exists for *user_id*."""
    row = _conn.execute(
        "SELECT 1 FROM user_meta WHERE user_id = ? LIMIT 1", (user_id,)
    ).fetchone()
    if row:
        return True
    row = _conn.execute(
        "SELECT 1 FROM user_classes WHERE user_id = ? LIMIT 1", (user_id,)
    ).fetchone()
    return row is not None


# ---------------------------------------------------------------------------
# Class shares
# ---------------------------------------------------------------------------

def get_share(token: str) -> dict | None:
    """Return the share dict for *token*, or None if not found."""
    row = _conn.execute(
        "SELECT doc FROM class_shares WHERE token = ?", (token,)
    ).fetchone()
    return _loads(row["doc"]) if row else None


def put_share(token: str, share_dict: dict) -> None:
    """Insert or replace a class share record.

    Extracts ``class_id``, ``active``, ``expires_at``, and ``encrypted_data``
    into dedicated columns for query use; stores full dict in ``doc``.
    """
    class_id = share_dict.get("class_id")
    active = 1 if share_dict.get("active", True) else 0
    expires_at = share_dict.get("expires_at")
    encrypted_data = share_dict.get("encrypted_data")
    _execute_write(
        """
        INSERT OR REPLACE INTO class_shares
            (token, class_id, active, expires_at, encrypted_data, doc)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (token, class_id, active, expires_at, encrypted_data, _dumps(share_dict)),
    )


def delete_share(token: str) -> None:
    """Delete a share by token (no-op if absent)."""
    _execute_write("DELETE FROM class_shares WHERE token = ?", (token,))


def iter_shares() -> list[tuple[str, dict]]:
    """Return all shares as a list of (token, share_dict) pairs."""
    rows = _conn.execute("SELECT token, doc FROM class_shares").fetchall()
    return [(row["token"], _loads(row["doc"])) for row in rows]


# ---------------------------------------------------------------------------
# Password reset tokens
# ---------------------------------------------------------------------------

def get_reset_token(token: str) -> dict | None:
    """Return the reset-token dict for *token*, or None if not found."""
    row = _conn.execute(
        "SELECT doc FROM password_reset_tokens WHERE token = ?", (token,)
    ).fetchone()
    return _loads(row["doc"]) if row else None


def put_reset_token(token: str, token_dict: dict) -> None:
    """Insert or replace a password reset token record.

    Extracts ``user_id`` (derived from ``user_email`` for the email-flow tokens
    which store the raw email, not a user_id — stored as-is) and ``expires_at``
    into dedicated columns.

    Note: the JSON field for the user identifier is ``user_email`` in the
    email-reset flow; this function stores whatever is in the dict verbatim and
    puts ``token_dict.get("user_id") or token_dict.get("user_email")`` into the
    indexed ``user_id`` column so queries by either key still work.
    """
    user_ref = token_dict.get("user_id") or token_dict.get("user_email")
    expires_at = token_dict.get("expires_at")
    _execute_write(
        """
        INSERT OR REPLACE INTO password_reset_tokens (token, user_id, expires_at, doc)
        VALUES (?, ?, ?, ?)
        """,
        (token, user_ref, expires_at, _dumps(token_dict)),
    )


def delete_reset_token(token: str) -> None:
    """Delete a reset token by value (no-op if absent)."""
    _execute_write("DELETE FROM password_reset_tokens WHERE token = ?", (token,))


def delete_expired_reset_tokens(now_iso: str) -> None:
    """Delete all reset tokens whose ``expires_at`` is before *now_iso*."""
    _execute_write(
        "DELETE FROM password_reset_tokens WHERE expires_at < ?", (now_iso,)
    )


def iter_reset_tokens() -> list[tuple[str, dict]]:
    """Return all reset tokens as a list of (token, token_dict) pairs."""
    rows = _conn.execute(
        "SELECT token, doc FROM password_reset_tokens"
    ).fetchall()
    return [(row["token"], _loads(row["doc"])) for row in rows]


# ---------------------------------------------------------------------------
# Organisations
# ---------------------------------------------------------------------------

def create_org(org_id: str, name: str, join_code: str, admin_user_id: str, created_at: str) -> None:
    """Insert a new org row."""
    _execute_write(
        "INSERT INTO orgs (id, name, join_code, admin_user_id, created_at) VALUES (?, ?, ?, ?, ?)",
        (org_id, name, join_code, admin_user_id, created_at),
    )


def get_org(org_id: str) -> dict | None:
    """Return the org dict for *org_id*, or None if not found."""
    row = _conn.execute(
        "SELECT id, name, join_code, admin_user_id, created_at FROM orgs WHERE id = ?",
        (org_id,),
    ).fetchone()
    return dict(row) if row else None


def get_org_by_join_code(join_code: str) -> dict | None:
    """Return the org dict for *join_code*, or None if not found."""
    row = _conn.execute(
        "SELECT id, name, join_code, admin_user_id, created_at FROM orgs WHERE join_code = ?",
        (join_code,),
    ).fetchone()
    return dict(row) if row else None


def get_org_membership(user_id: str) -> dict | None:
    """Return the membership row for *user_id* (at most one org per user), or None."""
    row = _conn.execute(
        "SELECT org_id, user_id, role, status, requested_at, approved_at "
        "FROM org_members WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    return dict(row) if row else None


def put_org_member(org_id: str, user_id: str, role: str, status: str, requested_at: str, approved_at: str | None = None) -> None:
    """Insert or replace a membership row."""
    _execute_write(
        """
        INSERT OR REPLACE INTO org_members
            (org_id, user_id, role, status, requested_at, approved_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (org_id, user_id, role, status, requested_at, approved_at),
    )


def list_pending_members(org_id: str) -> list[dict]:
    """Return pending membership rows for *org_id*."""
    rows = _conn.execute(
        "SELECT org_id, user_id, role, status, requested_at, approved_at "
        "FROM org_members WHERE org_id = ? AND status = 'pending'",
        (org_id,),
    ).fetchall()
    return [dict(row) for row in rows]


def list_org_members(org_id: str) -> list[dict]:
    """Return approved membership rows for *org_id*."""
    rows = _conn.execute(
        "SELECT org_id, user_id, role, status, requested_at, approved_at "
        "FROM org_members WHERE org_id = ? AND status = 'approved'",
        (org_id,),
    ).fetchall()
    return [dict(row) for row in rows]


def approve_member(org_id: str, user_id: str, approved_at: str) -> None:
    """Mark a pending membership as approved."""
    _execute_write(
        "UPDATE org_members SET status = 'approved', approved_at = ? WHERE org_id = ? AND user_id = ?",
        (approved_at, org_id, user_id),
    )


def remove_member(org_id: str, user_id: str) -> None:
    """Delete a membership row (reject a pending request, or leave/kick)."""
    _execute_write(
        "DELETE FROM org_members WHERE org_id = ? AND user_id = ?",
        (org_id, user_id),
    )


def delete_org(org_id: str) -> None:
    """Delete an org and all its memberships/roster rows."""
    with _write_lock:
        with _conn:
            _conn.execute("DELETE FROM orgs WHERE id = ?", (org_id,))
            _conn.execute("DELETE FROM org_members WHERE org_id = ?", (org_id,))
            _conn.execute("DELETE FROM org_roster WHERE org_id = ?", (org_id,))
            _conn.execute("DELETE FROM org_dpa WHERE org_id = ?", (org_id,))
            _conn.execute("DELETE FROM dpa_confirmations WHERE org_id = ?", (org_id,))


# ---------------------------------------------------------------------------
# Org roster (student name + class only, no grades — deliberate exception to
# the zero-knowledge model, scoped to name/class fields only)
# ---------------------------------------------------------------------------

def replace_roster_for_class(org_id: str, user_id: str, class_id: str, class_name: str, teacher_name: str, student_names: list[str], updated_at: str) -> None:
    """Replace all roster rows for one (org, teacher, class) with *student_names*."""
    with _write_lock:
        with _conn:
            _conn.execute(
                "DELETE FROM org_roster WHERE org_id = ? AND user_id = ? AND class_id = ?",
                (org_id, user_id, str(class_id)),
            )
            _conn.executemany(
                """
                INSERT OR REPLACE INTO org_roster
                    (org_id, user_id, class_id, student_name, class_name, teacher_name, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (org_id, user_id, str(class_id), name, class_name, teacher_name, updated_at)
                    for name in student_names
                ],
            )


def delete_roster_for_class(org_id: str, user_id: str, class_id: str) -> None:
    """Remove all roster rows for one (org, teacher, class)."""
    _execute_write(
        "DELETE FROM org_roster WHERE org_id = ? AND user_id = ? AND class_id = ?",
        (org_id, user_id, str(class_id)),
    )


def delete_roster_for_user(org_id: str, user_id: str) -> None:
    """Remove all roster rows for one teacher within an org (e.g. on leave)."""
    _execute_write(
        "DELETE FROM org_roster WHERE org_id = ? AND user_id = ?",
        (org_id, user_id),
    )


def list_roster(org_id: str) -> list[dict]:
    """Return all roster rows for *org_id* (student_name, class_name, teacher_name)."""
    rows = _conn.execute(
        "SELECT student_name, class_name, teacher_name FROM org_roster "
        "WHERE org_id = ? ORDER BY class_name, student_name",
        (org_id,),
    ).fetchall()
    return [dict(row) for row in rows]


# ---------------------------------------------------------------------------
# Class handovers
# ---------------------------------------------------------------------------

def put_handover(token: str, handover_dict: dict) -> None:
    """Insert or replace a class handover record.

    Extracts ``org_id``, ``from_user_id``, ``to_user_id``, ``class_id``,
    ``status``, ``encrypted_data``, ``created_at``, ``expires_at`` into
    dedicated columns; stores full dict in ``doc``.
    """
    _execute_write(
        """
        INSERT OR REPLACE INTO class_handovers
            (token, org_id, from_user_id, to_user_id, class_id, status,
             encrypted_data, created_at, expires_at, doc)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            token,
            handover_dict.get("org_id"),
            handover_dict.get("from_user_id"),
            handover_dict.get("to_user_id"),
            handover_dict.get("class_id"),
            handover_dict.get("status", "pending"),
            handover_dict.get("encrypted_data"),
            handover_dict.get("created_at"),
            handover_dict.get("expires_at"),
            _dumps(handover_dict),
        ),
    )


def get_handover(token: str) -> dict | None:
    """Return the handover dict for *token*, or None if not found."""
    row = _conn.execute(
        "SELECT doc FROM class_handovers WHERE token = ?", (token,)
    ).fetchone()
    return _loads(row["doc"]) if row else None


def list_handovers_for_user(user_id: str, status: str = "pending") -> list[tuple[str, dict]]:
    """Return (token, handover_dict) pairs addressed to *user_id* with the given status."""
    rows = _conn.execute(
        "SELECT token, doc FROM class_handovers WHERE to_user_id = ? AND status = ?",
        (user_id, status),
    ).fetchall()
    return [(row["token"], _loads(row["doc"])) for row in rows]


def delete_handover(token: str) -> None:
    """Delete a handover record by token (no-op if absent)."""
    _execute_write("DELETE FROM class_handovers WHERE token = ?", (token,))


def delete_expired_handovers(now_iso: str) -> None:
    """Delete every handover (any status) whose ``expires_at`` is before *now_iso*."""
    _execute_write(
        "DELETE FROM class_handovers WHERE expires_at < ?",
        (now_iso,),
    )


# ---------------------------------------------------------------------------
# Inactivity tracking (account deletion after 12 months without use)
# ---------------------------------------------------------------------------

def touch_last_active(user_id: str, now_iso: str) -> None:
    """Set ``last_active_at`` and reset every inactivity-warning marker, in one
    statement (no read-modify-write race with other user-doc writers)."""
    _execute_write(
        """
        UPDATE users
           SET doc = json_remove(
                         json_set(doc, '$.last_active_at', ?),
                         '$.inactivity_warnings_sent',
                         '$.inactivity_first_warning_at',
                         '$.inactivity_admin_notified_at'
                     )
         WHERE id = ?
        """,
        (now_iso, user_id),
    )


def set_user_json_field(user_id: str, key: str, value: Any) -> None:
    """Atomically set one top-level field of the user doc (``key`` must be a
    plain identifier chosen by the caller, never user input)."""
    if not key.replace("_", "").isalnum():
        raise ValueError("invalid field name")
    _execute_write(
        f"UPDATE users SET doc = json_set(doc, '$.{key}', json(?)) WHERE id = ?",
        (json.dumps(value), user_id),
    )


def record_inactivity_warning(user_id: str, stage: int, now_iso: str) -> None:
    """Mark warning *stage* (1..3) as sent; the first one also stamps the time."""
    with _write_lock:
        _conn.execute(
            """
            UPDATE users
               SET doc = json_set(
                             doc,
                             '$.inactivity_warnings_sent', ?,
                             '$.inactivity_first_warning_at',
                             COALESCE(json_extract(doc, '$.inactivity_first_warning_at'), ?)
                         )
             WHERE id = ?
            """,
            (stage, now_iso, user_id),
        )


# ---------------------------------------------------------------------------
# DPA (AVV) signature archive, org-level DPA, confirmation links
# ---------------------------------------------------------------------------

def add_dpa_signature(user_id: str, version: str, accepted_at: str, signer_name: str,
                      signer_school: str | None, basis: str, text_sha256: str,
                      org_id: str | None = None, confirmed_by_name: str | None = None,
                      confirmed_by_role: str | None = None,
                      confirmed_at: str | None = None) -> int:
    """Archive one signature. Idempotent per (user_id, version, accepted_at).
    Returns the row id. Never stores an e-mail address."""
    with _write_lock:
        row = _conn.execute(
            "SELECT id FROM dpa_signatures WHERE user_id = ? AND version = ? AND accepted_at = ?",
            (user_id, version, accepted_at)).fetchone()
        if row:
            return row["id"]
        cur = _conn.execute(
            "INSERT INTO dpa_signatures (user_id, version, accepted_at, signer_name, signer_school, "
            "basis, org_id, confirmed_by_name, confirmed_by_role, confirmed_at, text_sha256) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (user_id, version, accepted_at, signer_name, signer_school, basis, org_id,
             confirmed_by_name, confirmed_by_role, confirmed_at, text_sha256))
        return cur.lastrowid


def list_dpa_signatures(user_id: str) -> list[dict]:
    """All archived signatures of *user_id*, oldest first."""
    rows = _conn.execute(
        "SELECT * FROM dpa_signatures WHERE user_id = ? ORDER BY id", (user_id,)).fetchall()
    return [dict(r) for r in rows]


def confirm_dpa_signature(user_id: str, version: str, confirmed_by_name: str,
                          confirmed_by_role: str, confirmed_at: str) -> None:
    """Upgrade the user's pending signature of *version* to school_confirmed."""
    _execute_write(
        "UPDATE dpa_signatures SET basis = 'school_confirmed', confirmed_by_name = ?, "
        "confirmed_by_role = ?, confirmed_at = ? WHERE id = ("
        "SELECT id FROM dpa_signatures WHERE user_id = ? AND version = ? AND basis = 'school_pending' "
        "ORDER BY id DESC LIMIT 1)",
        (confirmed_by_name, confirmed_by_role, confirmed_at, user_id, version))


def mark_dpa_contract_ended(user_id: str, ended_at: str) -> None:
    """Mark all still-open signatures of *user_id* as ended at *ended_at*."""
    _execute_write(
        "UPDATE dpa_signatures SET contract_ended_at = ? "
        "WHERE user_id = ? AND contract_ended_at IS NULL", (ended_at, user_id))


def delete_expired_dpa_signatures(cutoff_iso: str) -> int:
    """Delete signatures whose contract ended before *cutoff_iso*. Returns the count."""
    cur = _execute_write(
        "DELETE FROM dpa_signatures WHERE contract_ended_at IS NOT NULL AND contract_ended_at < ?",
        (cutoff_iso,))
    return cur.rowcount


def migrate_dpa_signatures_from_users() -> int:
    """One-time/idempotent import of the DPA data stored in the user documents
    (current signature plus dpa_history) into dpa_signatures."""
    added = 0
    for _email, u in iter_users():
        uid = u.get("id")
        if not uid:
            continue
        entries = list(u.get("dpa_history") or [])
        if u.get("dpa_version"):
            entries.append({
                "version": u.get("dpa_version"), "accepted_at": u.get("dpa_accepted_at"),
                "signer_name": u.get("dpa_signer_name"), "signer_school": u.get("dpa_signer_school"),
                "text_sha256": u.get("dpa_text_sha256"),
                "basis": u.get("dpa_basis"), "org_id": u.get("dpa_org_id"),
            })
        for e in entries:
            if not e.get("version") or not e.get("accepted_at"):
                continue
            before = _conn.execute(
                "SELECT COUNT(*) AS n FROM dpa_signatures WHERE user_id = ?", (uid,)).fetchone()["n"]
            add_dpa_signature(uid, e["version"], e["accepted_at"], e.get("signer_name") or "",
                              e.get("signer_school"), e.get("basis") or "personal",
                              e.get("text_sha256") or "", org_id=e.get("org_id"))
            after = _conn.execute(
                "SELECT COUNT(*) AS n FROM dpa_signatures WHERE user_id = ?", (uid,)).fetchone()["n"]
            added += after - before
    return added


def get_org_dpa(org_id: str) -> dict | None:
    row = _conn.execute("SELECT * FROM org_dpa WHERE org_id = ?", (org_id,)).fetchone()
    return dict(row) if row else None


def set_org_dpa(org_id: str, version: str, school_name: str | None, confirmed_by_name: str,
                confirmed_by_role: str, confirmed_at: str, text_sha256: str) -> None:
    _execute_write(
        "INSERT OR REPLACE INTO org_dpa (org_id, version, school_name, confirmed_by_name, "
        "confirmed_by_role, confirmed_at, text_sha256) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (org_id, version, school_name, confirmed_by_name, confirmed_by_role, confirmed_at, text_sha256))


def put_dpa_confirmation(token_hash: str, kind: str, user_id: str, org_id: str | None,
                         version: str, principal_email: str | None, created_at: str,
                         expires_at: str) -> None:
    """Store a confirmation link; replaces older open links of the same user and kind."""
    with _write_lock:
        with _conn:
            _conn.execute("DELETE FROM dpa_confirmations WHERE user_id = ? AND kind = ?",
                          (user_id, kind))
            _conn.execute(
                "INSERT INTO dpa_confirmations (token_hash, kind, user_id, org_id, version, "
                "principal_email, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (token_hash, kind, user_id, org_id, version, principal_email, created_at, expires_at))


def get_dpa_confirmation(token_hash: str) -> dict | None:
    row = _conn.execute(
        "SELECT * FROM dpa_confirmations WHERE token_hash = ?", (token_hash,)).fetchone()
    return dict(row) if row else None


def get_dpa_confirmation_for(user_id: str, kind: str) -> dict | None:
    row = _conn.execute(
        "SELECT * FROM dpa_confirmations WHERE user_id = ? AND kind = ?", (user_id, kind)).fetchone()
    return dict(row) if row else None


def delete_dpa_confirmation(token_hash: str) -> None:
    _execute_write("DELETE FROM dpa_confirmations WHERE token_hash = ?", (token_hash,))


def delete_dpa_confirmation_for(user_id: str, kind: str) -> None:
    _execute_write("DELETE FROM dpa_confirmations WHERE user_id = ? AND kind = ?", (user_id, kind))


def delete_expired_dpa_confirmations(now_iso: str) -> int:
    cur = _execute_write("DELETE FROM dpa_confirmations WHERE expires_at < ?", (now_iso,))
    return cur.rowcount
