"""inactivity.py - delete accounts after 12 months without use.

Daily job with three warning mails (30, 7 and 1 day before the deletion).
The processor instructs this via DPA section 7; see LEGAL_FIXES.md part G.

Rules:
* ``last_active_at`` is set on login and at most once a day on API use.
  Accounts without it get the migration date (never created_at), so nobody is
  deleted right after the feature ships.
* Stage 1 is due 30 days before ``last_active_at + 365 d``. Deletion needs all
  three warnings sent AND at least 30 days since the first one; if that pushes
  the date back, stages 2 and 3 follow the real deletion date.
* A mail that fails to send is not counted and is retried on the next run, so
  an account is never deleted without three delivered warnings.
* Any activity resets all markers (db.touch_last_active).

Callbacks keep this module free of app.py imports:
  send_warning(user, stage, days_left, delete_at) -> awaitable, raises on failure
  delete_account(user) -> awaitable, may raise ValueError (org admin with members)
  notify_operator(user) -> awaitable (org-admin case, once per account)
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import db as db_layer

logger = logging.getLogger(__name__)

INACTIVITY_DAYS = 365
WARNING_DAYS = (30, 7, 1)       # days before deletion, stage 1..3
MIN_DAYS_SINCE_FIRST_WARNING = 30


def _parse(iso: str | None) -> datetime | None:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso)
    except (TypeError, ValueError):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def migrate_last_active(now: datetime | None = None) -> int:
    """Give every account without ``last_active_at`` the deployment date."""
    now_iso = (now or datetime.now(timezone.utc)).isoformat()
    n = 0
    for _email, user in db_layer.iter_users():
        if not user.get("last_active_at") and user.get("id"):
            db_layer.set_user_json_field(user["id"], "last_active_at", now_iso)
            n += 1
    if n:
        logger.info("Initialised last_active_at for %d account(s)", n)
    return n


def deletion_date(user: dict) -> datetime | None:
    """Earliest allowed deletion date for *user* (None if no baseline)."""
    last = _parse(user.get("last_active_at"))
    if last is None:
        return None
    due = last + timedelta(days=INACTIVITY_DAYS)
    first = _parse(user.get("inactivity_first_warning_at"))
    if first is not None:
        due = max(due, first + timedelta(days=MIN_DAYS_SINCE_FIRST_WARNING))
    return due


async def run_inactivity_job(send_warning, delete_account, notify_operator,
                             now: datetime | None = None) -> dict:
    """One daily pass. Returns counters: warned, deleted, blocked, failed."""
    now = now or datetime.now(timezone.utc)
    stats = {"warned": 0, "deleted": 0, "blocked": 0, "failed": 0}
    migrate_last_active(now)
    for _email, user in db_layer.iter_users():
        try:
            due = deletion_date(user)
            if due is None:
                continue
            sent = int(user.get("inactivity_warnings_sent") or 0)
            remaining = due - now

            if sent >= len(WARNING_DAYS) and remaining <= timedelta(0):
                try:
                    await delete_account(user)
                except ValueError:
                    # Org admin with other members: never auto-delete.
                    stats["blocked"] += 1
                    logger.warning("Inactive account %s not deleted: org admin with members", user["id"])
                    if not user.get("inactivity_admin_notified_at"):
                        await notify_operator(user)
                        db_layer.set_user_json_field(user["id"], "inactivity_admin_notified_at", now.isoformat())
                    continue
                stats["deleted"] += 1
                logger.info("Deleted inactive account %s", user["id"])
                continue

            if sent < len(WARNING_DAYS):
                threshold = timedelta(days=WARNING_DAYS[sent])
                if remaining <= threshold:
                    stage = sent + 1
                    shown_due = due
                    if stage == 1:
                        # Sending this mail starts the 30 day minimum notice.
                        shown_due = max(due, now + timedelta(days=MIN_DAYS_SINCE_FIRST_WARNING))
                    days_left = max(0, -(-int((shown_due - now).total_seconds()) // 86400))
                    await send_warning(user, stage, days_left, shown_due)
                    db_layer.record_inactivity_warning(user["id"], stage, now.isoformat())
                    stats["warned"] += 1
                    logger.info("Inactivity warning %d sent for account %s", stage, user["id"])
        except Exception as e:
            stats["failed"] += 1
            logger.warning("Inactivity job failed for account %s: %s", user.get("id"), type(e).__name__)
    return stats
