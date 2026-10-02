# EduGrade - Secure Classroom Grade Management System
# Copyright (C) 2026 Fabian Murauer
# Licensed under the GNU Affero General Public License v3.0 or later.

"""Self-check for the `dpa` console command (manage.py): lists archived DPA
signatures and filters those still waiting for the principal. Uses a
temporary database only. Run with:  python test_manage_dpa.py
"""

import contextlib
import io
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import manage

SCHEMA = """CREATE TABLE dpa_signatures (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, version TEXT NOT NULL,
    accepted_at TEXT NOT NULL, signer_name TEXT NOT NULL, signer_school TEXT, basis TEXT NOT NULL,
    org_id TEXT, confirmed_by_name TEXT, confirmed_by_role TEXT, confirmed_at TEXT,
    text_sha256 TEXT NOT NULL, contract_ended_at TEXT)"""


def _run(db: Path, arg: str) -> str:
    manage.DB_FILE = db
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        manage.Console().do_dpa(arg)
    return buf.getvalue()


def _make_db(path: Path) -> None:
    con = sqlite3.connect(str(path))
    con.execute(SCHEMA)
    con.executemany(
        "INSERT INTO dpa_signatures (user_id, version, accepted_at, signer_name, signer_school, basis,"
        " confirmed_by_name, confirmed_by_role, text_sha256, contract_ended_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [("u1", "1.1", "2026-10-02T10:00:00", "Anna Lehrerin", "HTL Test", "school_pending", None, None, "x", None),
         ("u2", "1.1", "2026-10-03T10:00:00", "Bernd Lehrer", "HTL Test", "school_confirmed",
          "Dr. Leiter", "principal", "x", None),
         ("u3", "1.0", "2026-09-01T10:00:00", "Carla Alt", None, "personal", None, None, "x", "2026-09-30T00:00:00")])
    con.commit()
    con.close()


def test_dpa_lists_all_and_open():
    old = manage.DB_FILE
    try:
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / "edugrade.db"
            _make_db(db)
            out = _run(db, "")
            assert "Anna Lehrerin" in out and "Bernd Lehrer" in out and "Carla Alt" in out
            assert "Dr. Leiter" in out and "beendet 2026-09-30" in out
            assert out.index("Bernd Lehrer") < out.index("Anna Lehrerin")  # newest first
            pending = _run(db, "--open")
            assert "Anna Lehrerin" in pending
            assert "Bernd Lehrer" not in pending and "Carla Alt" not in pending
    finally:
        manage.DB_FILE = old


def test_dpa_without_database():
    old = manage.DB_FILE
    try:
        with tempfile.TemporaryDirectory() as tmp:
            assert "Keine Datenbank" in _run(Path(tmp) / "missing.db", "")
    finally:
        manage.DB_FILE = old


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
    print("All dpa console tests passed.")
