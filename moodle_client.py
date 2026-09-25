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
Minimal async client for Moodle's REST web service protocol.

Auth is a per-teacher Web Service token — never a password. A teacher
generates their own token in Moodle under Profile → Preferences →
"Security keys" (needs the `moodle/webservice:createtoken` capability,
commonly already granted since it's the same page the official Moodle
mobile app uses). The token is independently revocable in Moodle without
touching the teacher's login password.

Endpoint: ``POST {moodle_url}/webservice/rest/server.php`` with
``wstoken``/``wsfunction``/``moodlewsrestformat=json`` as query params.
Moodle's REST protocol takes function parameters as a form-encoded body
using PHP bracket notation for nested arrays/objects (``events[0][name]=..``)
— NOT a JSON body. ``_flatten_params`` builds that from a plain dict/list.

Verified against Moodle core source (moodle/moodle on GitHub, `main`
branch: public/webservice/externallib.php, public/enrol/externallib.php,
public/calendar/externallib.php) — not a live school instance. Verify
against a real Moodle site before shipping.

ponytail: no retry/backoff, one request per call. Add pooling/backoff if a
school's Moodle turns out to be flaky under load.
"""

import httpx

MOODLE_TIMEOUT = 10.0


class MoodleError(Exception):
    """Base error for Moodle API failures."""


class MoodleAuthError(MoodleError):
    """Invalid/revoked token, or the token's service lacks a capability."""


class MoodleConnectionError(MoodleError):
    """Network/server unreachable, or a non-JSON response."""


def _normalize_url(url: str) -> str:
    url = url.strip().rstrip('/')
    if not url:
        return url
    if not url.startswith('http://') and not url.startswith('https://'):
        url = f'https://{url}'
    return url


def _flatten_params(params: dict) -> dict:
    """Flatten a dict (nested dicts/lists allowed) into Moodle's
    ``key[sub][0][field]=value`` form-body shape."""
    out: dict = {}

    def walk(prefix: str, value) -> None:
        if isinstance(value, dict):
            for k, v in value.items():
                walk(f'{prefix}[{k}]', v)
        elif isinstance(value, (list, tuple)):
            for i, v in enumerate(value):
                walk(f'{prefix}[{i}]', v)
        elif value is None:
            out[prefix] = ''
        elif isinstance(value, bool):
            out[prefix] = 1 if value else 0
        else:
            out[prefix] = value

    for key, val in params.items():
        walk(key, val)
    return out


# errorcode/exception substrings that mean "bad or revoked token" rather than
# some other server-side failure — best-effort, Moodle doesn't document an
# exhaustive list.
_AUTH_ERROR_HINTS = ('token', 'accessexception', 'invalidlogin')


class MoodleClient:
    """One client per connect/push request — not held across requests."""

    def __init__(self, url: str, token: str):
        self.url = _normalize_url(url)
        self.token = token.strip()
        self._endpoint = f'{self.url}/webservice/rest/server.php'
        self._client = httpx.AsyncClient(timeout=MOODLE_TIMEOUT)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        await self.close()

    async def close(self):
        await self._client.aclose()

    async def _call(self, wsfunction: str, params: dict | None = None):
        try:
            resp = await self._client.post(
                self._endpoint,
                params={'wstoken': self.token, 'wsfunction': wsfunction, 'moodlewsrestformat': 'json'},
                data=_flatten_params(params or {}),
            )
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPError as e:
            raise MoodleConnectionError(str(e)) from e
        except ValueError as e:
            raise MoodleConnectionError(f'Invalid response from Moodle: {e}') from e

        if isinstance(data, dict) and 'exception' in data:
            message = data.get('message', 'unknown Moodle error')
            errorcode = (data.get('errorcode') or '').lower()
            haystack = f'{errorcode} {data.get("exception", "")}'.lower()
            if any(hint in haystack for hint in _AUTH_ERROR_HINTS):
                raise MoodleAuthError(message)
            raise MoodleError(message)
        return data

    async def get_site_info(self) -> dict:
        """Returns {userid, fullname, sitename, functions: {name, ...}}."""
        result = await self._call('core_webservice_get_site_info')
        return result or {}

    async def get_courses(self, userid: int) -> list[dict]:
        result = await self._call('core_enrol_get_users_courses', {'userid': userid}) or []
        return [{'id': c.get('id'), 'name': c.get('fullname') or c.get('shortname', '')} for c in result]

    async def create_course_event(self, courseid: int, name: str, timestart: int, timeduration: int = 0) -> dict:
        """Creates a course-visible calendar event (eventtype='course', so
        it shows for enrolled students, not just the teacher's own calendar)."""
        result = await self._call('core_calendar_create_calendar_events', {
            'events': [{
                'name': name,
                'eventtype': 'course',
                'courseid': courseid,
                'timestart': timestart,
                'timeduration': timeduration,
            }]
        }) or {}
        warnings = result.get('warnings') or []
        if warnings:
            raise MoodleError(warnings[0].get('message', 'Moodle rejected the event'))
        return result
