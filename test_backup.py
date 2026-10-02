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
Self-check for the encrypted database backup (backup.py): consistent copy via
the SQLite backup API, AES-GCM round trip against the original content, wrong
key / tampering detection, 30-day pruning, one backup per day, no backup
without BACKUP_KEY, and restore. Uses temporary directories only. Run with:

    python test_backup.py
"""

import os
import sqlite3
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import backup

KEY = "test-backup-key"


def _make_db(path: Path, rows: int = 50) -> None:
    con = sqlite3.connect(str(path))
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")
    con.executemany("INSERT INTO t (v) VALUES (?)", [(f"row {i}",) for i in range(rows)])
    con.commit()
    con.close()


def _dump(path: Path) -> list:
    con = sqlite3.connect(str(path))
    try:
        return con.execute("SELECT id, v FROM t ORDER BY id").fetchall()
    finally:
        con.close()


def test_roundtrip_matches_original():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        src = tmp / "edugrade.db"
        _make_db(src)
        out = backup.create_backup(KEY, src, tmp / "backups")
        assert out.name.startswith("edugrade-") and out.name.endswith(".db.enc")
        blob = out.read_bytes()
        assert blob.startswith(backup.MAGIC)
        assert b"SQLite format" not in blob and b"row 1" not in blob  # really encrypted
        plain = backup.decrypt_bytes(blob, KEY)
        copy = tmp / "copy.db"
        copy.write_bytes(plain)
        assert _dump(copy) == _dump(src)


def test_wrong_key_and_tampering_rejected():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        src = tmp / "edugrade.db"
        _make_db(src, 3)
        blob = backup.create_backup(KEY, src, tmp / "b").read_bytes()
        for bad in (lambda: backup.decrypt_bytes(blob, "other-key"),
                    lambda: backup.decrypt_bytes(blob[:-1] + bytes([blob[-1] ^ 1]), KEY),
                    lambda: backup.decrypt_bytes(b"garbage", KEY)):
            try:
                bad()
            except backup.BackupError:
                continue
            raise AssertionError("expected BackupError")


def test_no_key_no_backup():
    with tempfile.TemporaryDirectory() as tmp:
        old = {k: os.environ.pop(k, None) for k in ("BACKUP_KEY", "BACKUP_DIR")}
        os.environ["BACKUP_DIR"] = str(Path(tmp) / "b")
        try:
            assert backup.run_daily_backup() is None
            assert backup.list_backups() == []
            try:
                backup.create_backup()
            except backup.BackupError:
                pass
            else:
                raise AssertionError("create_backup must refuse without a key")
        finally:
            for k, v in old.items():
                os.environ.pop(k, None)
                if v is not None:
                    os.environ[k] = v


def test_prune_after_30_days():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        src = tmp / "edugrade.db"
        _make_db(src, 2)
        d = tmp / "b"
        now = datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc)
        old = backup.create_backup(KEY, src, d, now - timedelta(days=31))
        edge = backup.create_backup(KEY, src, d, now - timedelta(days=29))
        new = backup.create_backup(KEY, src, d, now)
        removed = backup.prune_backups(d, now)
        assert removed == [old]
        assert not old.exists() and edge.exists() and new.exists()


def test_daily_job_one_per_day_and_prunes():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        src = tmp / "edugrade.db"
        _make_db(src, 2)
        old_env = {k: os.environ.get(k) for k in ("BACKUP_KEY", "BACKUP_DIR")}
        os.environ["BACKUP_KEY"] = KEY
        os.environ["BACKUP_DIR"] = str(tmp / "b")
        saved_db = backup.DB_FILE
        backup.DB_FILE = src
        try:
            now = datetime.now(timezone.utc)
            backup.create_backup(KEY, src, tmp / "b", now - timedelta(days=40))
            first = backup.run_daily_backup(now)
            assert first is not None and first.exists()
            assert backup.run_daily_backup(now + timedelta(minutes=5)) is None  # same day
            assert len(backup.list_backups()) == 1  # the 40 day old one is gone
        finally:
            backup.DB_FILE = saved_db
            for k, v in old_env.items():
                os.environ.pop(k, None)
                if v is not None:
                    os.environ[k] = v


def test_restore_replaces_db_and_keeps_safety_copy():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        live = tmp / "edugrade.db"
        _make_db(live, 10)
        original = _dump(live)
        bak = backup.create_backup(KEY, live, tmp / "b")
        # damage the live DB afterwards
        con = sqlite3.connect(str(live))
        con.execute("DELETE FROM t")
        con.commit()
        con.close()
        (tmp / "edugrade.db-wal").write_bytes(b"stale")
        safety = backup.restore_backup(bak, KEY, live)
        assert _dump(live) == original
        assert safety is not None and safety.exists() and _dump(safety) == []
        assert not (tmp / "edugrade.db-wal").exists()


def test_restore_wrong_key_leaves_db_untouched():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        live = tmp / "edugrade.db"
        _make_db(live, 4)
        bak = backup.create_backup(KEY, live, tmp / "b")
        before = live.read_bytes()
        try:
            backup.restore_backup(bak, "wrong", live)
        except backup.BackupError:
            pass
        else:
            raise AssertionError("expected BackupError")
        assert live.read_bytes() == before
        assert not (tmp / "edugrade.db.restore-tmp").exists()


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
    print("All backup tests passed.")
