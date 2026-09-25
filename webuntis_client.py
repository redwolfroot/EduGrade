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
Minimal async client for the WebUntis legacy JSON-RPC API.

WebUntis exposes a JSON-RPC 2.0 endpoint at
``https://<server>/WebUntis/jsonrpc.do?school=<school>``. This client covers
only what EduGrade needs (login, class list, roster, own timetable) — it is
not a general-purpose WebUntis SDK.

Login uses the same TOTP-secret flow as the official Untis Mobile app's
"pair another device" QR code (WebUntis → Profil → Freigaben → "Zugriff über
Untis Mobile" → Anzeigen) — never the teacher's actual WebUntis password.
The secret is independently revocable in WebUntis without changing the main
login, unlike a stored password. See ``parse_qr_code`` for the pasted-QR
convenience path and ``_totp`` for the RFC 6238 implementation (stdlib only,
no pyotp dependency).

ponytail: no retry/backoff, one request per call, no connection reuse across
calls beyond a single client instance's lifetime. Add pooling/backoff if a
school's WebUntis server turns out to be flaky under load.

Known ceiling: WebUntis school configs vary — some restrict ``getStudents``
to admin-level accounts (data-privacy rule), and the response schema for
class membership on a student record isn't guaranteed identical across
versions. ``get_students`` best-effort filters by ``klasseIds``/``klasseId``
when present and falls back to the unfiltered list (with a flag) otherwise.
The secret-login flow and the ``/api/app/config`` personId lookup are based
on community reverse-engineering docs, not an official spec — verify against
a real school's WebUntis instance before shipping.
"""

import base64
import hashlib
import hmac
import struct
import time
from urllib.parse import urlparse, parse_qs

import httpx

WEBUNTIS_TIMEOUT = 10.0

# JSON-RPC error codes WebUntis returns for auth/permission failures.
# Not exhaustively documented anywhere official — best-effort from community
# references. Anything else surfaces as a generic WebUntisError.
_AUTH_ERROR_CODES = {-8504, -8509, -8520, -8998}


class WebUntisError(Exception):
    """Base error for WebUntis API failures."""


class WebUntisAuthError(WebUntisError):
    """Wrong secret, or the account lacks the requested permission."""


class WebUntisConnectionError(WebUntisError):
    """Network/server unreachable, or a non-JSON-RPC response."""


def _normalize_server(server: str) -> str:
    server = server.strip().rstrip('/')
    if not server:
        return server
    if not server.startswith('http://') and not server.startswith('https://'):
        server = f'https://{server}'
    return server


def _totp(secret_b32: str, digits: int = 6, period: int = 30) -> str:
    """RFC 6238 TOTP over a base32 secret, HMAC-SHA1, 30s step — same
    algorithm the Untis Mobile app uses for its QR-paired login."""
    key = secret_b32.strip().replace(' ', '').upper()
    key += '=' * (-len(key) % 8)  # pad to a multiple of 8 for base32
    key_bytes = base64.b32decode(key)
    counter = int(time.time() // period)
    digest = hmac.new(key_bytes, struct.pack('>Q', counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = (struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7FFFFFFF) % (10 ** digits)
    return str(code).zfill(digits)


def parse_qr_code(qr_content: str) -> dict:
    """Parse a pasted WebUntis pairing QR code (``untis://setschool?...``)
    into ``{server, school, username, secret}``.

    Raises ValueError if the string isn't a recognizable WebUntis QR link.
    """
    qr_content = (qr_content or '').strip()
    if not qr_content.startswith('untis://'):
        raise ValueError('Not a WebUntis QR code link')
    parsed = urlparse(qr_content)
    params = parse_qs(parsed.query)

    def first(key: str) -> str:
        return (params.get(key) or [''])[0].strip()

    server, school, username, secret = first('url'), first('school'), first('user'), first('key')
    if not (server and school and username and secret):
        raise ValueError('WebUntis QR code is missing required fields')
    return {'server': server, 'school': school, 'username': username, 'secret': secret}


class WebUntisClient:
    """One client per connect/import/sync request — not held across requests."""

    def __init__(self, server: str, school: str):
        self.server = _normalize_server(server)
        self.school = school.strip()
        self._url = f'{self.server}/WebUntis/jsonrpc.do'
        self._session_id: str | None = None
        self._person_id: int | None = None
        self._person_type: int | None = None
        self._client = httpx.AsyncClient(timeout=WEBUNTIS_TIMEOUT)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        await self.close()

    async def close(self):
        if self._session_id:
            try:
                await self._rpc('logout')
            except WebUntisError:
                pass
        await self._client.aclose()

    async def _rpc(self, method: str, params: dict | None = None):
        payload = {'id': 'edugrade', 'method': method, 'params': params or {}, 'jsonrpc': '2.0'}
        cookies = {'JSESSIONID': self._session_id} if self._session_id else None
        try:
            resp = await self._client.post(
                self._url, params={'school': self.school}, json=payload, cookies=cookies
            )
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPError as e:
            raise WebUntisConnectionError(str(e)) from e
        except ValueError as e:
            raise WebUntisConnectionError(f'Invalid JSON-RPC response: {e}') from e

        if 'error' in data:
            err = data['error'] or {}
            code = err.get('code')
            message = err.get('message', 'unknown WebUntis error')
            if code in _AUTH_ERROR_CODES:
                raise WebUntisAuthError(message)
            raise WebUntisError(message)
        return data.get('result')

    async def login(self, username: str, secret: str) -> None:
        """Log in via the QR/TOTP-secret flow. Raises WebUntisAuthError on a
        bad secret or malformed base32 (never accepts/needs a password)."""
        try:
            otp = int(_totp(secret))
        except Exception as e:
            raise WebUntisAuthError(f'Invalid WebUntis secret: {e}') from e

        payload = {
            'id': 'edugrade',
            'method': 'getUserData2017',
            'params': [{'auth': {'clientTime': int(time.time() * 1000), 'user': username, 'otp': otp}}],
            'jsonrpc': '2.0',
        }
        try:
            resp = await self._client.post(
                f'{self.server}/WebUntis/jsonrpc_intern.do',
                params={'m': 'getUserData2017', 'school': self.school, 'v': 'i2.2'},
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPError as e:
            raise WebUntisConnectionError(str(e)) from e
        except ValueError as e:
            raise WebUntisConnectionError(f'Invalid JSON-RPC response: {e}') from e

        if 'error' in data:
            err = data['error'] or {}
            code = err.get('code')
            message = err.get('message', 'unknown WebUntis error')
            if code in _AUTH_ERROR_CODES:
                raise WebUntisAuthError(message)
            raise WebUntisError(message)

        session_id = resp.cookies.get('JSESSIONID')
        if not session_id:
            raise WebUntisAuthError('WebUntis login failed (no session)')
        self._session_id = session_id
        await self._fetch_person_info()

    async def _fetch_person_info(self) -> None:
        """Best-effort personId/personType lookup for get_timetable(). Not
        needed for get_klassen()/get_students(). Silently leaves both unset
        on any failure — get_timetable() then raises a clear error instead
        of crashing the connect/import flow over a timetable-only lookup."""
        try:
            resp = await self._client.get(
                f'{self.server}/WebUntis/api/app/config',
                cookies={'JSESSIONID': self._session_id},
            )
            resp.raise_for_status()
            user = resp.json()['data']['loginServiceConfig']['user']
            person_id = user['personId']
            person_type = next(
                (p.get('type') for p in user.get('persons', []) if p.get('id') == person_id), None
            )
            self._person_id = person_id
            self._person_type = person_type
        except Exception:
            self._person_id = None
            self._person_type = None

    async def get_klassen(self) -> list[dict]:
        """Return [{id, name}] for every class visible to this account."""
        result = await self._rpc('getKlassen') or []
        return [
            {'id': k.get('id'), 'name': k.get('longName') or k.get('name', '')}
            for k in result
        ]

    async def get_students(self, klasse_id: int) -> tuple[list[dict], bool]:
        """Return ([{firstName, lastName}], filtered) for one class.

        ``filtered`` is False when the school's WebUntis response has no
        class-membership field to filter on — callers should warn the user
        the roster may include students outside the chosen class in that case.
        """
        result = await self._rpc('getStudents') or []
        has_klasse_field = any(
            s.get('klasseId') is not None or s.get('klasseIds') is not None for s in result
        )

        def in_klasse(s: dict) -> bool:
            if s.get('klasseId') is not None:
                return s['klasseId'] == klasse_id
            if s.get('klasseIds') is not None:
                return klasse_id in (s.get('klasseIds') or [])
            return True

        students = [
            {'firstName': s.get('foreName', ''), 'lastName': s.get('longName', '')}
            for s in result
            if not has_klasse_field or in_klasse(s)
        ]
        return students, has_klasse_field

    async def get_timetable(self, start: str, end: str) -> list[dict]:
        """Own (teacher) timetable between start/end (``YYYYMMDD`` strings)."""
        if self._person_id is None or self._person_type is None:
            raise WebUntisError('Could not determine WebUntis person id for timetable lookup')
        result = await self._rpc(
            'getTimetable',
            {
                'id': self._person_id,
                'type': self._person_type,
                'startDate': start,
                'endDate': end,
            },
        ) or []
        periods = []
        for p in result:
            subjects = p.get('su') or []
            klassen = p.get('kl') or []
            rooms = p.get('ro') or []
            periods.append({
                'date': p.get('date'),
                'startTime': p.get('startTime'),
                'endTime': p.get('endTime'),
                'subject': subjects[0].get('longName') or subjects[0].get('name', '') if subjects else '',
                'klasse': klassen[0].get('longName') or klassen[0].get('name', '') if klassen else '',
                'room': rooms[0].get('name', '') if rooms else '',
                'cancelled': p.get('code') == 'cancelled',
            })
        return periods
