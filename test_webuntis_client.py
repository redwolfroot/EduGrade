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
Self-check for webuntis_client.py's TOTP/JSON-RPC parsing logic, using a
mocked HTTP transport (no real WebUntis server involved). Run with:

    python test_webuntis_client.py
"""

import asyncio
import json

import httpx

from webuntis_client import WebUntisClient, WebUntisAuthError, _totp, parse_qr_code

VALID_SECRET = 'JBSWY3DPEHPK3PXP'  # RFC 4648 test-vector base32 string


def _rpc_response(method: str) -> dict:
    if method == 'getKlassen':
        return [
            {'id': 1, 'name': '1A', 'longName': '1A'},
            {'id': 2, 'name': '2B', 'longName': ''},
        ]
    if method == 'getStudents':
        return [
            {'foreName': 'Anna', 'longName': 'Muster', 'klasseId': 1},
            {'foreName': 'Ben', 'longName': 'Beispiel', 'klasseId': 2},
        ]
    if method == 'getTimetable':
        return [
            {
                'date': 20260921, 'startTime': 800, 'endTime': 845,
                'su': [{'longName': 'Mathematik'}], 'kl': [{'longName': '1A'}],
                'ro': [{'name': 'R101'}], 'code': None,
            }
        ]
    if method == 'logout':
        return None
    raise AssertionError(f'unexpected method {method}')


def make_transport(fail_auth: bool = False) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith('/jsonrpc_intern.do'):
            if fail_auth:
                return httpx.Response(200, json={'id': 'edugrade', 'jsonrpc': '2.0',
                                                  'error': {'code': -8504, 'message': 'bad secret'}})
            return httpx.Response(
                200, json={'id': 'edugrade', 'jsonrpc': '2.0', 'result': None},
                headers={'set-cookie': 'JSESSIONID=abc123; Path=/WebUntis'},
            )
        if request.url.path.endswith('/api/app/config'):
            return httpx.Response(200, json={
                'data': {'loginServiceConfig': {'user': {
                    'personId': 7, 'persons': [{'id': 7, 'type': 2}]
                }}}
            })
        # classic jsonrpc.do
        data = json.loads(request.content)
        result = _rpc_response(data['method'])
        return httpx.Response(200, json={'id': 'edugrade', 'jsonrpc': '2.0', 'result': result})
    return httpx.MockTransport(handler)


async def run():
    # TOTP is a pure function — sanity-check it's a 6-digit numeric string.
    code = _totp(VALID_SECRET)
    assert len(code) == 6 and code.isdigit()

    # QR-code parsing
    qr = 'untis://setschool?url=herakles.webuntis.com&school=demoschool&user=teacher1&key=' + VALID_SECRET
    parsed = parse_qr_code(qr)
    assert parsed == {
        'server': 'herakles.webuntis.com', 'school': 'demoschool',
        'username': 'teacher1', 'secret': VALID_SECRET,
    }
    try:
        parse_qr_code('not a qr code')
        raise AssertionError('expected ValueError')
    except ValueError:
        pass

    client = WebUntisClient('demo.webuntis.com', 'demoschool')
    client._client = httpx.AsyncClient(transport=make_transport())

    await client.login('teacher1', VALID_SECRET)
    assert client._session_id == 'abc123'
    assert client._person_id == 7
    assert client._person_type == 2

    klassen = await client.get_klassen()
    assert klassen == [{'id': 1, 'name': '1A'}, {'id': 2, 'name': '2B'}]

    students, filtered = await client.get_students(1)
    assert filtered is True
    assert students == [{'firstName': 'Anna', 'lastName': 'Muster'}]

    periods = await client.get_timetable('20260921', '20260921')
    assert len(periods) == 1
    assert periods[0]['subject'] == 'Mathematik'
    assert periods[0]['klasse'] == '1A'
    assert periods[0]['cancelled'] is False

    await client.close()

    # Auth failure path
    bad_client = WebUntisClient('demo.webuntis.com', 'demoschool')
    bad_client._client = httpx.AsyncClient(transport=make_transport(fail_auth=True))
    try:
        await bad_client.login('teacher1', VALID_SECRET)
        raise AssertionError('expected WebUntisAuthError')
    except WebUntisAuthError:
        pass
    await bad_client._client.aclose()

    print('webuntis_client self-check OK')


if __name__ == '__main__':
    asyncio.run(run())
