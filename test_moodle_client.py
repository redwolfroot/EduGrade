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
Self-check for moodle_client.py's bracket-notation flattening and REST
parsing logic, using a mocked HTTP transport (no real Moodle server
involved). Run with:

    python test_moodle_client.py
"""

import asyncio
from urllib.parse import parse_qs

import httpx

from moodle_client import MoodleClient, MoodleAuthError, MoodleError, _flatten_params


def test_flatten():
    flat = _flatten_params({
        'events': [{'name': 'SA1', 'courseid': 3, 'timestart': 100, 'visible': True}]
    })
    assert flat == {
        'events[0][name]': 'SA1',
        'events[0][courseid]': 3,
        'events[0][timestart]': 100,
        'events[0][visible]': 1,
    }
    assert _flatten_params({'userid': 7}) == {'userid': 7}
    assert _flatten_params({'x': None}) == {'x': ''}


def make_transport(fail: bool = False) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        qs = parse_qs(request.url.query.decode())
        fn = qs['wsfunction'][0]
        if fail:
            return httpx.Response(200, json={'exception': 'webservice_access_exception',
                                              'errorcode': 'invalidtoken', 'message': 'Invalid token'})
        if fn == 'core_webservice_get_site_info':
            return httpx.Response(200, json={
                'userid': 7, 'fullname': 'Teacher One', 'sitename': 'Demo School',
                'functions': [
                    {'name': 'core_enrol_get_users_courses'},
                    {'name': 'core_calendar_create_calendar_events'},
                ],
            })
        if fn == 'core_enrol_get_users_courses':
            return httpx.Response(200, json=[
                {'id': 3, 'shortname': 'M1', 'fullname': 'Mathematik 1A'},
            ])
        if fn == 'core_calendar_create_calendar_events':
            body = parse_qs(request.content.decode())
            assert body['events[0][eventtype]'] == ['course']
            assert body['events[0][courseid]'] == ['3']
            return httpx.Response(200, json={'events': [{'id': 42}], 'warnings': []})
        raise AssertionError(f'unexpected wsfunction {fn}')
    return httpx.MockTransport(handler)


async def run():
    test_flatten()

    client = MoodleClient('demo.moodle.school', 'faketoken')
    client._client = httpx.AsyncClient(transport=make_transport())

    info = await client.get_site_info()
    assert info['userid'] == 7

    courses = await client.get_courses(7)
    assert courses == [{'id': 3, 'name': 'Mathematik 1A'}]

    result = await client.create_course_event(3, 'SA1', 1758000000)
    assert result['events'][0]['id'] == 42

    await client.close()

    bad_client = MoodleClient('demo.moodle.school', 'wrongtoken')
    bad_client._client = httpx.AsyncClient(transport=make_transport(fail=True))
    try:
        await bad_client.get_site_info()
        raise AssertionError('expected MoodleAuthError')
    except MoodleAuthError:
        pass
    await bad_client._client.aclose()

    print('moodle_client self-check OK')


if __name__ == '__main__':
    asyncio.run(run())
