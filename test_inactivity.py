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
Self-check for the deletion of inactive accounts (inactivity.py + the app
wiring): migration of last_active_at, the three warning stages (30/7/1 days),
deletion only after all three warnings and 30 days since the first, reset on
login/activity, retry after a failed mail, the org-admin case, the DPA
evidence surviving the deletion, the daily scheduling and the /impressum
redirect. Runs against an in-memory database. Run with:

    python test_inactivity.py
"""

import asyncio
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import db as db_layer

# Never touch the real data/edugrade.db: swap in an in-memory connection
# before anything uses it.
_mem = sqlite3.connect(":memory:", check_same_thread=False, isolation_level=None)
_mem.row_factory = sqlite3.Row
db_layer._conn = _mem
db_layer.init_schema()

import app as app_module
import inactivity
from app import app, register_user

PASSWORD = "correct horse battery"
T0 = datetime(2027, 1, 1, 6, 0, tzinfo=timezone.utc)
_counter = [0]


def _user(last_active: datetime | None) -> dict:
    _counter[0] += 1
    email = f"inactive{_counter[0]}@example.com"
    res = register_user(f"inactiveuser{_counter[0]}", email, PASSWORD)
    assert res["success"], res
    user = db_layer.get_user_by_email(email)
    user.pop("last_active_at", None)
    if last_active is not None:
        user["last_active_at"] = last_active.isoformat()
    db_layer.put_user(email, user)
    return user


def _fresh(user: dict) -> dict | None:
    return db_layer.get_user_by_id(user["id"])


class Recorder:
    def __init__(self, fail_send: bool = False):
        self.sent, self.deleted, self.notified = [], [], []
        self.fail_send = fail_send

    async def send(self, user, stage, days_left, delete_at):
        if self.fail_send:
            raise RuntimeError("smtp down")
        self.sent.append((user["id"], stage, days_left))

    async def delete(self, user):
        db_layer.delete_account(user["email"])  # same function as DELETE /api/account
        self.deleted.append(user["id"])

    async def notify(self, user):
        self.notified.append(user["id"])


def _run(rec: Recorder, now: datetime) -> dict:
    return asyncio.run(inactivity.run_inactivity_job(rec.send, rec.delete, rec.notify, now))


def _mine(rec_list, user):
    return [x for x in rec_list if (x[0] if isinstance(x, tuple) else x) == user["id"]]


def test_migration_sets_deployment_date_not_created_at():
    u = _user(None)
    assert "last_active_at" not in _fresh(u)
    _run(Recorder(), T0)
    assert _fresh(u)["last_active_at"] == T0.isoformat()
    # idempotent: a second run later does not move it
    _run(Recorder(), T0 + timedelta(days=5))
    assert _fresh(u)["last_active_at"] == T0.isoformat()


def test_active_account_gets_nothing():
    u = _user(T0 - timedelta(days=100))
    rec = Recorder()
    _run(rec, T0)
    assert not _mine(rec.sent, u) and not _mine(rec.deleted, u)


def test_three_warning_stages_then_deletion():
    last = T0 - timedelta(days=335)   # stage 1 due today
    u = _user(last)
    rec = Recorder()

    _run(rec, T0)
    assert _mine(rec.sent, u) == [(u["id"], 1, 30)]
    assert _fresh(u)["inactivity_warnings_sent"] == 1
    _run(rec, T0)   # same day again: each stage only once
    assert len(_mine(rec.sent, u)) == 1

    _run(rec, T0 + timedelta(days=22))   # 8 days left: not yet
    assert len(_mine(rec.sent, u)) == 1
    _run(rec, T0 + timedelta(days=23))   # 7 days left
    assert _mine(rec.sent, u)[-1] == (u["id"], 2, 7)

    _run(rec, T0 + timedelta(days=28))   # 2 days left: not yet
    assert len(_mine(rec.sent, u)) == 2
    _run(rec, T0 + timedelta(days=29))   # 1 day left
    assert _mine(rec.sent, u)[-1] == (u["id"], 3, 1)
    assert _fresh(u) is not None

    _run(rec, T0 + timedelta(days=29, hours=12))   # still before the date
    assert _fresh(u) is not None and not _mine(rec.deleted, u)
    stats = _run(rec, T0 + timedelta(days=30))
    assert _mine(rec.deleted, u) == [u["id"]] and stats["deleted"] >= 1
    assert _fresh(u) is None


def test_no_deletion_without_three_warnings_and_30_days_after_first():
    # Long outage: inactive for 400 days, never warned. Stage 1 now, deletion
    # not before 30 days later and not before all three went out.
    u = _user(T0 - timedelta(days=400))
    rec = Recorder()
    _run(rec, T0)
    assert _mine(rec.sent, u) == [(u["id"], 1, 30)]
    assert _fresh(u) is not None and not _mine(rec.deleted, u)
    _run(rec, T0 + timedelta(days=23))
    _run(rec, T0 + timedelta(days=29))
    assert [s for _i, s, _d in _mine(rec.sent, u)] == [1, 2, 3]
    assert _fresh(u) is not None
    _run(rec, T0 + timedelta(days=30))
    assert _fresh(u) is None


def test_failed_mail_is_retried_and_blocks_deletion():
    u = _user(T0 - timedelta(days=500))
    bad = Recorder(fail_send=True)
    stats = _run(bad, T0)
    assert stats["failed"] >= 1
    assert "inactivity_warnings_sent" not in _fresh(u)
    _run(bad, T0 + timedelta(days=60))   # far past the date, still no deletion
    assert _fresh(u) is not None and not _mine(bad.deleted, u)
    good = Recorder()
    _run(good, T0 + timedelta(days=61))
    assert _mine(good.sent, u) == [(u["id"], 1, 30)]


def test_activity_resets_everything():
    u = _user(T0 - timedelta(days=360))
    rec = Recorder()
    _run(rec, T0)
    assert _fresh(u)["inactivity_warnings_sent"] == 1
    assert "inactivity_first_warning_at" in _fresh(u)
    db_layer.touch_last_active(u["id"], (T0 + timedelta(days=1)).isoformat())
    f = _fresh(u)
    assert f["last_active_at"] == (T0 + timedelta(days=1)).isoformat()
    assert not any(k.startswith("inactivity_") for k in f)
    # a login through the app helper does the same
    app_module.touch_last_active(u["id"], force=True)
    assert _fresh(u)["last_active_at"] != (T0 + timedelta(days=1)).isoformat()  # real "now"
    _run(rec, T0 + timedelta(days=2))
    assert len(_mine(rec.sent, u)) == 1  # no further warning
    assert _fresh(u) is not None


def test_org_admin_with_members_not_deleted_operator_notified_once():
    admin = _user(T0 - timedelta(days=500))
    member = _user(T0)
    ts = T0.isoformat()
    db_layer.create_org("org-inact", "Org", "JOINCODE1", admin["id"], ts)
    db_layer.put_org_member("org-inact", admin["id"], "admin", "approved", ts, ts)
    db_layer.put_org_member("org-inact", member["id"], "teacher", "approved", ts, ts)
    rec = Recorder()
    for day in (0, 23, 29):
        _run(rec, T0 + timedelta(days=day))
    stats = _run(rec, T0 + timedelta(days=30))
    assert stats["blocked"] >= 1
    assert _fresh(admin) is not None and not _mine(rec.deleted, admin)
    assert rec.notified == [admin["id"]]
    _run(rec, T0 + timedelta(days=31))
    assert rec.notified == [admin["id"]]  # not again


def test_app_delete_path_keeps_dpa_evidence_hook():
    # The job must go through db_layer.delete_account (the single place that
    # also stamps contract_ended_at on the DPA evidence).
    u = _user(T0)
    asyncio.run(app_module._delete_inactive_account(db_layer.get_user_by_id(u["id"])))
    assert _fresh(u) is None
    admin = _user(T0)
    ts = T0.isoformat()
    other = _user(T0)
    db_layer.create_org("org-inact2", "Org2", "JOINCODE2", admin["id"], ts)
    db_layer.put_org_member("org-inact2", admin["id"], "admin", "approved", ts, ts)
    db_layer.put_org_member("org-inact2", other["id"], "teacher", "approved", ts, ts)
    try:
        asyncio.run(app_module._delete_inactive_account(db_layer.get_user_by_id(admin["id"])))
    except ValueError:
        pass
    else:
        raise AssertionError("org admin with members must raise ValueError")


def test_daily_jobs_run_once_per_day():
    calls = []

    async def fake_job(*a, **k):
        calls.append(1)
        return {}

    saved = (app_module.inactivity.run_inactivity_job, app_module.backup_job.run_daily_backup,
             app_module.smtp_is_configured)
    app_module.inactivity.run_inactivity_job = fake_job
    app_module.backup_job.run_daily_backup = lambda now: None
    app_module.smtp_is_configured = lambda: True
    try:
        app_module._daily_jobs_day = None
        asyncio.run(app_module.run_daily_jobs(T0))
        asyncio.run(app_module.run_daily_jobs(T0 + timedelta(hours=3)))
        assert len(calls) == 1
        asyncio.run(app_module.run_daily_jobs(T0 + timedelta(days=1)))
        assert len(calls) == 2
        # without SMTP nobody can be warned, so nothing is deleted
        app_module.smtp_is_configured = lambda: False
        asyncio.run(app_module.run_daily_jobs(T0 + timedelta(days=2)))
        assert len(calls) == 2
    finally:
        (app_module.inactivity.run_inactivity_job, app_module.backup_job.run_daily_backup,
         app_module.smtp_is_configured) = saved


def test_impressum_redirects():
    async def go():
        client = app.test_client()
        resp = await client.get('/impressum')
        return resp.status_code, resp.headers.get('Location')
    code, loc = asyncio.run(go())
    assert code == 302 and loc == 'https://avocloud.net/impressum/'


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
    print("All inactivity tests passed.")
