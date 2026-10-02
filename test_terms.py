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
Self-check for the terms-of-service consent (TERMS_VERSION): stored at
registration, write lock with 403 terms_required until accepted via
POST /api/terms/accept, exemptions, ordering after the DPA, and the i18n keys
of the Art. 9 hints. Runs against an in-memory database. Run with:

    python test_terms.py
"""

import asyncio
import json
import os
import sqlite3
import sys
from pathlib import Path

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import db as db_layer

# Never touch the real data/edugrade.db: swap in an in-memory connection
# before anything uses it.
_mem = sqlite3.connect(":memory:", check_same_thread=False, isolation_level=None)
_mem.row_factory = sqlite3.Row
db_layer._conn = _mem
db_layer.init_schema()

import app as app_module
from app import (
    app, register_user, _create_session, needs_terms_acceptance, TERMS_VERSION,
    DPA_VERSION, _terms_exempt,
)

PASSWORD = "correct horse battery"


def _new_user(n: int, dpa: bool = True, terms: bool = True) -> tuple[dict, str]:
    email = f"terms{n}@example.com"
    res = register_user(f"termsuser{n}", email, PASSWORD)
    assert res["success"], res
    user = db_layer.get_user_by_email(email)
    if dpa:
        user["dpa_version"] = DPA_VERSION
    if not terms:
        user.pop("terms_version", None)
        user.pop("terms_accepted_at", None)
    db_layer.put_user(email, user)
    token = _create_session(user["id"], res["_dek"], False)
    return db_layer.get_user_by_email(email), token


def test_registration_stores_terms():
    user, _ = _new_user(1)
    assert user["terms_version"] == TERMS_VERSION == "2.0"
    assert user["terms_accepted_at"]
    assert not needs_terms_acceptance(user)


def test_needs_terms_acceptance():
    assert needs_terms_acceptance({})
    assert needs_terms_acceptance({"terms_version": "1.0"})
    assert not needs_terms_acceptance({"terms_version": TERMS_VERSION})


def test_exempt_rules():
    assert _terms_exempt("/api/data", "GET")
    assert not _terms_exempt("/api/data", "POST")
    assert not _terms_exempt("/api/data/class/abc", "DELETE")
    assert _terms_exempt("/api/account", "DELETE")
    assert _terms_exempt("/api/terms/accept", "POST")
    assert _terms_exempt("/api/heartbeat", "POST")
    assert _terms_exempt("/api/disconnect", "POST")
    assert not _terms_exempt("/api/share/class", "POST")


async def _lock_flow():
    client = app.test_client()
    user, token = _new_user(2, terms=False)  # migration case: no terms_version
    assert needs_terms_acceptance(user)
    headers = {"Authorization": f"Bearer {token}", "X-Requested-With": "XMLHttpRequest"}

    # Reading stays possible.
    res = await client.get("/api/data", headers=headers)
    assert res.status_code == 200, res.status_code

    # Writing is locked with terms_required.
    res = await client.post("/api/data", headers=headers, json={})
    assert res.status_code == 403
    body = await res.get_json()
    assert body["terms_required"] is True

    # Housekeeping is not locked.
    res = await client.post("/api/heartbeat", headers=headers)
    assert res.status_code != 403, "heartbeat must stay exempt"

    # Wrong version / missing flag is rejected.
    res = await client.post("/api/terms/accept", headers=headers, json={"accepted": True, "version": "0.1"})
    assert res.status_code == 400
    res = await client.post("/api/terms/accept", headers=headers, json={"version": TERMS_VERSION})
    assert res.status_code == 400
    assert needs_terms_acceptance(db_layer.get_user_by_email(user["email"]))

    # Accepting unlocks writes and stores version + timestamp.
    res = await client.post("/api/terms/accept", headers=headers, json={"accepted": True, "version": TERMS_VERSION})
    assert res.status_code == 200
    stored = db_layer.get_user_by_email(user["email"])
    assert stored["terms_version"] == TERMS_VERSION and stored["terms_accepted_at"]
    res = await client.post("/api/data", headers=headers, json={})
    assert res.status_code != 403 or not (await res.get_json()).get("terms_required")

    # Account deletion works while the terms are pending.
    user3, token3 = _new_user(3, terms=False)
    res = await client.delete("/api/account", headers={"Authorization": f"Bearer {token3}", "X-Requested-With": "XMLHttpRequest"})
    assert res.status_code == 200, res.status_code
    assert db_layer.get_user_by_email(user3["email"]) is None


async def _dpa_first():
    client = app.test_client()
    user, token = _new_user(4, dpa=False, terms=False)
    headers = {"Authorization": f"Bearer {token}", "X-Requested-With": "XMLHttpRequest"}
    # Unsigned DPA wins: the user signs the AVV first, the terms modal comes after.
    res = await client.post("/api/data", headers=headers, json={})
    assert res.status_code == 403
    body = await res.get_json()
    assert body.get("dpa_required") is True and not body.get("terms_required")
    # The terms accept call itself is not available before the DPA is signed.
    res = await client.post("/api/terms/accept", headers=headers, json={"accepted": True, "version": TERMS_VERSION})
    assert res.status_code == 403
    assert (await res.get_json()).get("dpa_required") is True


async def _register_requires_terms():
    client = app.test_client()
    payload = {"username": "termsreg", "email": "termsreg@example.com",
               "password": PASSWORD, "password_confirm": PASSWORD}
    res = await client.post("/api/register", json=payload, headers={"X-Requested-With": "XMLHttpRequest"})
    assert res.status_code == 400
    assert db_layer.get_user_by_email("termsreg@example.com") is None


async def _index_flag():
    client = app.test_client()
    user, token = _new_user(5, terms=False)
    client.set_cookie("localhost", "session_token", token)
    res = await client.get("/")
    html = (await res.get_data()).decode()
    assert res.status_code == 200
    assert "window.__termsRequired = true" in html
    assert 'id="terms-dialog"' in html
    assert 'data-i18n="recovery.emailWarning"' in html


def test_lock_flow():
    asyncio.run(_lock_flow())


def test_dpa_comes_first():
    asyncio.run(_dpa_first())


def test_register_requires_terms_flag():
    asyncio.run(_register_requires_terms())


def test_index_flag():
    asyncio.run(_index_flag())


def test_i18n_keys():
    keys = ["terms.modal.title", "terms.modal.accept", "terms.modal.exportDelete",
            "backend.termsRequired", "privacy.sensitiveHint", "grade.commentPlaceholder",
            "classExam.notePlaceholder", "recovery.emailWarning"]
    for lang in ("de", "en"):
        data = json.loads((Path(__file__).parent / "static" / "i18n" / f"{lang}.json").read_text(encoding="utf-8"))
        for k in keys:
            assert data.get(k), f"{lang}: missing {k}"


def test_sensitive_hint_in_ui():
    root = Path(__file__).parent
    for rel, n in (("static/scripts/render.js", 3), ("static/scripts/dataManagement.js", 2), ("templates/index.html", 1)):
        assert (root / rel).read_text(encoding="utf-8").count("privacy.sensitiveHint") >= n, rel


if __name__ == "__main__":
    failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except Exception as e:  # noqa: BLE001
                failed += 1
                import traceback
                traceback.print_exc()
                print(f"FAIL {name}: {e!r}")
    sys.exit(1 if failed else 0)
