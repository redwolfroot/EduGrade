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
Self-check for the DPA signature archive (dpa_signatures), the three signing
paths (org / school with principal confirmation / personal), the principal
confirmation link, pending orgs and leaving an org. Runs against an in-memory
database. Run with:

    python test_dpa_signatures.py
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
from app import (
    app, register_user, register_org_admin, _create_session, needs_dpa_signature,
    DPA_VERSION, cleanup_dpa_records, _dpa_token_hash, DPA_RETENTION_DAYS,
)

PASSWORD = "correct horse battery"
_counter = [0]


def _hdr(token):
    return {"Authorization": f"Bearer {token}", "X-Requested-With": "XMLHttpRequest"}


def _new_user(signed: bool = False):
    _counter[0] += 1
    n = _counter[0]
    email = f"dpasig{n}@example.com"
    res = register_user(f"dpauser{n}", email, PASSWORD)
    assert res["success"], res
    user = db_layer.get_user_by_email(email)
    if signed:
        user["dpa_version"] = DPA_VERSION
    else:
        user.pop("dpa_version", None)
        user["dpa_shown_version"] = DPA_VERSION
        user["dpa_shown_at"] = (datetime.now(timezone.utc) - timedelta(seconds=120)).isoformat()
    db_layer.put_user(email, user)
    token = _create_session(user["id"], res["_dek"], False)
    return db_layer.get_user_by_email(email), token


def _new_org_admin():
    _counter[0] += 1
    n = _counter[0]
    email = f"dpaorg{n}@example.com"
    res = register_org_admin(f"Schule {n}", f"dpaadmin{n}", email, PASSWORD)
    assert res["success"], res
    user = db_layer.get_user_by_email(email)
    user.pop("dpa_version", None)
    user["dpa_shown_version"] = DPA_VERSION
    user["dpa_shown_at"] = (datetime.now(timezone.utc) - timedelta(seconds=120)).isoformat()
    db_layer.put_user(email, user)
    token = _create_session(user["id"], res["_dek"], False)
    return db_layer.get_user_by_email(email), token, res["org"]


class _Mail:
    """Captures confirmation mails instead of sending them."""
    def __enter__(self):
        self.sent = []
        self._old = (app_module.smtp_is_configured, app_module.send_dpa_confirmation_email)

        async def fake(to_addr, signer_name, school, link, kind, lang="de"):
            self.sent.append({"to": to_addr, "link": link, "kind": kind, "lang": lang, "school": school})

        app_module.smtp_is_configured = lambda: True
        app_module.send_dpa_confirmation_email = fake
        return self

    def __exit__(self, *exc):
        app_module.smtp_is_configured, app_module.send_dpa_confirmation_email = self._old

    @property
    def token(self):
        return self.sent[-1]["link"].rsplit("/", 1)[1]


def _body(name="Erika Muster", choice="personal", **extra):
    return {"name": name, "school": "HTL Test", "accepted": True, "version": DPA_VERSION,
            "choice": choice, "personal_ack": True, **extra}


def _run(coro):
    return asyncio.run(coro)


# ---------------------------------------------------------------- B: archive

async def _archive_flow():
    client = app.test_client()
    user, token = _new_user()
    res = await client.post("/api/dpa/accept", headers=_hdr(token), json=_body())
    assert res.status_code == 200, await res.get_data()
    sigs = db_layer.list_dpa_signatures(user["id"])
    assert len(sigs) == 1
    s = sigs[0]
    assert s["version"] == DPA_VERSION and s["basis"] == "personal" and s["signer_name"] == "Erika Muster"
    assert s["text_sha256"] and s["contract_ended_at"] is None
    assert "email" not in s and user["email"] not in str(s)

    # Deleting the account keeps the proof and marks the contract as ended.
    res = await client.delete("/api/account", headers=_hdr(token))
    assert res.status_code == 200, res.status_code
    assert db_layer.get_user_by_email(user["email"]) is None
    sigs = db_layer.list_dpa_signatures(user["id"])
    assert len(sigs) == 1 and sigs[0]["contract_ended_at"]
    ended = datetime.fromisoformat(sigs[0]["contract_ended_at"])

    # Cleanup: kept just before 3 years, gone after 3 years + 1 day.
    cleanup_dpa_records(ended + timedelta(days=3 * 365 - 1))
    assert len(db_layer.list_dpa_signatures(user["id"])) == 1
    cleanup_dpa_records(ended + timedelta(days=3 * 365 + 2))
    assert db_layer.list_dpa_signatures(user["id"]) == []


def test_signature_archived_survives_delete_and_expires():
    _run(_archive_flow())
    assert DPA_RETENTION_DAYS >= 3 * 365


def test_open_signature_is_never_cleaned_up():
    user, _ = _new_user()
    db_layer.add_dpa_signature(user["id"], "1.0", "2020-01-01T00:00:00+00:00", "A B C", None, "personal", "x")
    cleanup_dpa_records(datetime.now(timezone.utc) + timedelta(days=5000))
    assert len(db_layer.list_dpa_signatures(user["id"])) == 1


def test_migration_from_user_documents_is_idempotent():
    user, _ = _new_user(signed=True)
    user.update({
        "dpa_accepted_at": "2026-05-01T10:00:00+00:00", "dpa_signer_name": "Max Muster",
        "dpa_signer_school": "BG Wels", "dpa_text_sha256": "abc",
        "dpa_history": [{"version": "0.9", "accepted_at": "2026-01-01T10:00:00+00:00",
                         "signer_name": "Max Muster", "signer_school": "", "text_sha256": "old"}],
    })
    db_layer.put_user(user["email"], user)
    db_layer.migrate_dpa_signatures_from_users()
    db_layer.migrate_dpa_signatures_from_users()
    sigs = db_layer.list_dpa_signatures(user["id"])
    assert [x["version"] for x in sigs] == ["0.9", DPA_VERSION]
    assert all(x["basis"] == "personal" for x in sigs)


# ------------------------------------------------------------ A1: three paths

def test_choice_required_and_validation():
    async def go():
        client = app.test_client()
        user, token = _new_user()
        res = await client.post("/api/dpa/accept", headers=_hdr(token), json={**_body(), "choice": None})
        assert res.status_code == 400
        with _Mail():
            # school path needs a valid principal e-mail and the acknowledgement
            for extra in ({}, {"principal_email": "nope"}, {"principal_email": "p@school.at"},
                          {"principal_email": user["email"], "school_ack": True}):
                res = await client.post("/api/dpa/accept", headers=_hdr(token),
                                        json=_body(choice="school", **extra))
                assert res.status_code == 400, extra
        # org path without an org
        res = await client.post("/api/dpa/accept", headers=_hdr(token), json=_body(choice="org"))
        assert res.status_code == 400
        assert needs_dpa_signature(db_layer.get_user_by_email(user["email"]) | {"id": user["id"]})
    _run(go())


async def _school_flow(expire=False):
    client = app.test_client()
    user, token = _new_user()
    with _Mail() as mail:
        res = await client.post("/api/dpa/accept", headers=_hdr(token), json=_body(
            choice="school", principal_email="direktion@school.at", school_ack=True, lang="en"))
        assert res.status_code == 200, await res.get_data()
        assert mail.sent[0]["to"] == "direktion@school.at" and mail.sent[0]["lang"] == "en"
        assert mail.sent[0]["kind"] == "personal"
        raw = mail.token
    stored = db_layer.get_user_by_email(user["email"])
    assert stored["dpa_basis"] == "school_pending"
    assert not needs_dpa_signature({"id": user["id"], "dpa_version": stored["dpa_version"], "dpa_basis": "school_pending"})
    # Only the hash is stored.
    assert db_layer.get_dpa_confirmation(raw) is None
    assert db_layer.get_dpa_confirmation(_dpa_token_hash(raw))["principal_email"] == "direktion@school.at"

    if expire:
        db_layer._conn.execute("UPDATE dpa_confirmations SET expires_at = ?",
                     ((datetime.now(timezone.utc) - timedelta(days=1)).isoformat(),))
        res = await client.get(f"/avv/confirm/{raw}")
        assert res.status_code == 200 and "dpa-confirm-form" not in (await res.get_data(as_text=True))
        res = await client.post(f"/api/dpa/confirm/{raw}", headers={"X-Requested-With": "XMLHttpRequest"},
                                json={"name": "Dir Ektor", "role": "principal", "school": "HTL Test", "accepted": True})
        assert res.status_code == 404
        assert db_layer.get_user_by_email(user["email"])["dpa_basis"] == "school_pending"
        # Resend (the expired row is replaced by a new token).
        with _Mail() as mail2:
            res = await client.post("/api/dpa/resend", headers=_hdr(token),
                                    json={"principal_email": "direktion@school.at"})
            assert res.status_code == 200 and mail2.sent
            raw = mail2.token

    cx = {"X-Requested-With": "XMLHttpRequest"}
    res = await client.get(f"/avv/confirm/{raw}")
    assert "dpa-confirm-form" in (await res.get_data(as_text=True))
    # incomplete confirmation is rejected
    res = await client.post(f"/api/dpa/confirm/{raw}", headers=cx,
                            json={"name": "Dir Ektor", "role": "boss", "school": "HTL Test", "accepted": True})
    assert res.status_code == 400
    res = await client.post(f"/api/dpa/confirm/{raw}", headers=cx,
                            json={"name": "Dir Ektor", "role": "principal", "school": "HTL Test", "accepted": True})
    assert res.status_code == 200, await res.get_data()
    stored = db_layer.get_user_by_email(user["email"])
    assert stored["dpa_basis"] == "school_confirmed" and stored["dpa_confirmed_by_name"] == "Dir Ektor"
    sig = db_layer.list_dpa_signatures(user["id"])[-1]
    assert sig["basis"] == "school_confirmed" and sig["confirmed_by_role"] == "principal" and sig["confirmed_at"]
    # single use, and the stored address is gone
    assert db_layer.get_dpa_confirmation(_dpa_token_hash(raw)) is None
    res = await client.post(f"/api/dpa/confirm/{raw}", headers=cx,
                            json={"name": "Dir Ektor", "role": "principal", "school": "HTL Test", "accepted": True})
    assert res.status_code == 404


def test_school_path_with_principal_confirmation():
    _run(_school_flow())


def test_confirmation_link_expiry_and_resend():
    _run(_school_flow(expire=True))


def test_school_path_mail_failure_does_not_sign():
    async def go():
        client = app.test_client()
        user, token = _new_user()
        with _Mail():
            async def boom(*a, **k):
                raise RuntimeError("smtp down")
            app_module.send_dpa_confirmation_email = boom
            res = await client.post("/api/dpa/accept", headers=_hdr(token), json=_body(
                choice="school", principal_email="direktion@school.at", school_ack=True))
            assert res.status_code == 502
        assert not db_layer.get_user_by_email(user["email"]).get("dpa_version")
        assert db_layer.list_dpa_signatures(user["id"]) == []
    _run(go())


def test_account_deletion_drops_open_confirmation():
    async def go():
        client = app.test_client()
        user, token = _new_user()
        with _Mail():
            await client.post("/api/dpa/accept", headers=_hdr(token), json=_body(
                choice="school", principal_email="direktion@school.at", school_ack=True))
        assert db_layer.get_dpa_confirmation_for(user["id"], "personal")
        await client.delete("/api/account", headers=_hdr(token))
        assert db_layer.get_dpa_confirmation_for(user["id"], "personal") is None
    _run(go())


# ------------------------------------------------------------ orgs

async def _org_flow():
    client = app.test_client()
    admin, atoken, org = _new_org_admin()
    org_id = org["id"]
    # New org is pending: no row, no joins.
    assert not app_module._org_dpa_confirmed(org_id)
    t1, tok1 = _new_user(signed=True)
    res = await client.post("/api/org/join", headers=_hdr(tok1), json={"join_code": org["join_code"]})
    assert res.status_code == 403
    assert (await res.get_json())["message"] == "backend.orgDpaPending"
    assert db_layer.get_org_membership(t1["id"]) is None

    # The org path is not offered while the org is pending.
    t2, tok2 = _new_user()
    db_layer.put_org_member(org_id, t2["id"], "teacher", "approved", "2026-01-01", "2026-01-01")
    res = await client.post("/api/dpa/accept", headers=_hdr(tok2), json=_body(choice="org"))
    assert res.status_code == 400
    # A plain member cannot sign for the org.
    res = await client.post("/api/dpa/accept", headers=_hdr(tok2), json=_body(choice="org_principal", role="principal"))
    assert res.status_code == 400

    # The owner is principal and signs for the whole org.
    res = await client.post("/api/dpa/accept", headers=_hdr(atoken), json=_body(
        name="Direktor Hans", choice="org_principal", role="principal"))
    assert res.status_code == 200, await res.get_data()
    assert app_module._org_dpa_confirmed(org_id)
    row = db_layer.get_org_dpa(org_id)
    assert row["confirmed_by_name"] == "Direktor Hans" and row["confirmed_by_role"] == "principal"
    assert not needs_dpa_signature(app_module.get_user_from_token(atoken))

    # Now members can sign via the org and new teachers can join.
    res = await client.post("/api/dpa/accept", headers=_hdr(tok2), json=_body(choice="org"))
    assert res.status_code == 200, await res.get_data()
    sig = db_layer.list_dpa_signatures(t2["id"])[-1]
    assert sig["basis"] == "org" and sig["org_id"] == org_id
    assert not needs_dpa_signature(app_module.get_user_from_token(tok2))
    res = await client.post("/api/org/join", headers=_hdr(tok1), json={"join_code": org["join_code"]})
    assert res.status_code == 200

    # Leaving the org sends the member back to the signing page.
    res = await client.post("/api/org/leave", headers=_hdr(tok2))
    assert res.status_code == 200, await res.get_data()
    assert needs_dpa_signature(app_module.get_user_from_token(tok2))
    res = await client.get("/api/data", headers=_hdr(tok2))
    assert res.status_code == 403 and (await res.get_json()).get("dpa_required")
    # ...and can pick the personal path.
    res = await client.post("/api/dpa/accept", headers=_hdr(tok2), json=_body(choice="personal", personal_ack=True))
    assert res.status_code == 200
    assert not needs_dpa_signature(app_module.get_user_from_token(tok2))


def test_org_pending_blocks_joins_and_org_path():
    _run(_org_flow())


def test_removed_member_must_sign_again():
    async def go():
        client = app.test_client()
        admin, atoken, org = _new_org_admin()
        res = await client.post("/api/dpa/accept", headers=_hdr(atoken), json=_body(
            name="Direktor Hans", choice="org_principal", role="delegated"))
        assert res.status_code == 200
        t, tok = _new_user()
        db_layer.put_org_member(org["id"], t["id"], "teacher", "approved", "2026-01-01", "2026-01-01")
        res = await client.post("/api/dpa/accept", headers=_hdr(tok), json=_body(choice="org"))
        assert res.status_code == 200
        res = await client.post(f"/api/org/members/{t['id']}/reject", headers=_hdr(atoken))
        assert res.status_code == 200, await res.get_data()
        assert needs_dpa_signature(app_module.get_user_from_token(tok))
    _run(go())


def test_existing_org_migration_pending_then_confirmed_by_link():
    """A pre-existing org (no org_dpa row): members keep working, new joins and
    approvals are blocked, the owner asks the principal by mail."""
    async def go():
        client = app.test_client()
        admin, atoken, org = _new_org_admin()
        # Owner is on the old DPA version already; the org simply has no row.
        admin["dpa_version"] = DPA_VERSION
        db_layer.put_user(admin["email"], admin)
        member, mtoken = _new_user(signed=True)
        db_layer.put_org_member(org["id"], member["id"], "teacher", "approved", "2026-01-01", "2026-01-01")
        assert not needs_dpa_signature(app_module.get_user_from_token(mtoken))
        applicant, apptoken = _new_user(signed=True)
        db_layer.put_org_member(org["id"], applicant["id"], "teacher", "pending", "2026-01-01", None)
        res = await client.post(f"/api/org/members/{applicant['id']}/approve", headers=_hdr(atoken))
        assert res.status_code == 403

        status = await (await client.get("/api/org/status", headers=_hdr(atoken))).get_json()
        assert status["org"]["dpa_confirmed"] is False

        with _Mail() as mail:
            res = await client.post("/api/org/dpa/request", headers=_hdr(atoken),
                                    json={"principal_email": "direktion@school.at", "lang": "de"})
            assert res.status_code == 200, await res.get_data()
            assert mail.sent[0]["kind"] == "org"
            raw = mail.token
        res = await client.post(f"/api/dpa/confirm/{raw}", headers={"X-Requested-With": "XMLHttpRequest"},
                                json={"name": "Dir Ektor", "role": "principal", "school": "BG Wels", "accepted": True})
        assert res.status_code == 200, await res.get_data()
        assert app_module._org_dpa_confirmed(org["id"])
        assert db_layer.get_org_dpa(org["id"])["school_name"] == "BG Wels"
        res = await client.post(f"/api/org/members/{applicant['id']}/approve", headers=_hdr(atoken))
        assert res.status_code == 200
        # Already confirmed: a second request is refused.
        res = await client.post("/api/org/dpa/request", headers=_hdr(atoken), json={"principal_email": "x@school.at"})
        assert res.status_code == 409
    _run(go())


def test_org_owner_confirms_for_himself_and_via_school_path():
    async def go():
        client = app.test_client()
        admin, atoken, org = _new_org_admin()
        admin["dpa_version"] = DPA_VERSION
        db_layer.put_user(admin["email"], admin)
        res = await client.post("/api/org/dpa/request", headers=_hdr(atoken), json={
            "self": True, "name": "Direktor Hans", "role": "principal", "accepted": True})
        assert res.status_code == 200, await res.get_data()
        assert app_module._org_dpa_confirmed(org["id"])

        # Org owner who signs via the school path: the link confirms the org.
        admin2, atoken2, org2 = _new_org_admin()
        with _Mail() as mail:
            res = await client.post("/api/dpa/accept", headers=_hdr(atoken2), json=_body(
                choice="school", principal_email="direktion@school.at", school_ack=True))
            assert res.status_code == 200, await res.get_data()
            assert mail.sent[0]["kind"] == "org"
            raw = mail.token
        assert not app_module._org_dpa_confirmed(org2["id"])
        res = await client.post(f"/api/dpa/confirm/{raw}", headers={"X-Requested-With": "XMLHttpRequest"},
                                json={"name": "Dir Ektor", "role": "delegated", "school": "BG Wels", "accepted": True})
        assert res.status_code == 200
        assert app_module._org_dpa_confirmed(org2["id"])
        assert db_layer.get_user_by_email(admin2["email"])["dpa_basis"] == "school_confirmed"
    _run(go())


def test_sign_page_offers_paths_by_org_state():
    async def go():
        client = app.test_client()
        admin, atoken, org = _new_org_admin()
        page = await (await client.get("/avv/sign", headers=_hdr(atoken))).get_data(as_text=True)
        assert 'value="school"' in page and 'value="personal"' in page
        assert 'value="org_principal"' in page and 'value="org"' not in page
        await client.post("/api/dpa/accept", headers=_hdr(atoken), json=_body(choice="org_principal", role="principal"))
        t, tok = _new_user()
        db_layer.put_org_member(org["id"], t["id"], "teacher", "approved", "2026-01-01", "2026-01-01")
        page = await (await client.get("/avv/sign", headers=_hdr(tok))).get_data(as_text=True)
        assert 'value="org"' in page and 'value="org_principal"' not in page
        solo, stok = _new_user()
        page = await (await client.get("/avv/sign", headers=_hdr(stok))).get_data(as_text=True)
        assert 'value="org"' not in page and 'value="personal"' in page
    _run(go())


def test_i18n_keys_present():
    import json
    from pathlib import Path
    for lang in ("de", "en"):
        data = json.loads((Path(__file__).parent / "static" / "i18n" / f"{lang}.json").read_text(encoding="utf-8"))
        for k in ("backend.orgDpaPending", "backend.dpaOrgNotConfirmed", "backend.dpaPrincipalInvalid",
                  "backend.dpaMailFailed", "backend.dpaLinkInvalid", "dpaNotice.orgPending",
                  "dpaNotice.askPrincipal", "dpaNotice.personalPending"):
            assert data.get(k), f"{lang}: missing {k}"


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
