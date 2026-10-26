"""Real HTTP/WS boundary tests with signed member cookies and isolated data."""
import concurrent.futures
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import auth, deps, settings
from app.main import app
from app.rooms.service import COOKIE, PLAYER_TTL, RoomService
from app.rooms.transport import RoomBus

BASE = '/api/rooms/test-game'
ORIGIN = {'origin': 'http://testserver'}


class RoomBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / 'dist').mkdir()
        (self.root / 'dist/index.html').write_text('<html><head></head><body>game</body></html>')
        (self.root / 'dist/game.js').write_text('export const game=true')
        (self.root / 'secret.py').write_text('private')
        self.now = [time.time()]
        self.hub = RoomService(self.root / 'rooms.sqlite3', clock=lambda: self.now[0])
        self.hub.bus = RoomBus(self.hub)
        self.dispose = self.hub.register('test-game', lambda: dict(
            root=str(self.root), entry='dist/index.html', build='test-build',
            protocol=1, maps=['desert', 'snow'], characters=['male', 'female'],
            guest_events=['player', 'action'], host_events=['pvp-state', 'pvp-finish']))
        context = SimpleNamespace(get=lambda key: self.hub if key == 'rooms' else None)
        self.patches = [patch.object(deps, 'manager', SimpleNamespace(ctx=context)),
                        patch.object(settings, 'APP_PLUGINS_DIR', self.root.parent),
                        patch.object(settings, 'ROOM_PUBLIC_URL', ''),
                        patch.object(auth, '_secret_cache', b'room-test-only'),
                        patch.object(auth, 'DEBUG_DISABLE_AUTH', False)]
        for p in self.patches:
            p.start()
        self.host = TestClient(app, headers=ORIGIN)
        self.host.cookies.set(auth.COOKIE_NAME, auth.create_session('owner'))
        self.guest = TestClient(app, headers=ORIGIN)
        # A real plugin symlink exercises the static resource boundary.
        self.plugin = self.root.parent / 'test-game'
        self.plugin.symlink_to(self.root, target_is_directory=True)

    def tearDown(self):
        self.host.close()
        self.guest.close()
        self.dispose()
        self.hub.close()
        self.plugin.unlink(missing_ok=True)
        for p in reversed(self.patches):
            p.stop()
        self.tmp.cleanup()

    def create(self):
        response = self.host.post(BASE, json={})
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        token = parse_qs(urlsplit(data['invite']['url']).fragment)['invite'][0]
        return data['room'], token

    def redeem(self, room, token, client=None):
        return (client or self.guest).post(f'{BASE}/{room["id"]}/redeem',
                                         json={'token': token, 'name': '好友'})

    def test_invitation_ten_minutes_session_twenty_four_hours(self):
        room, token = self.create()
        result = self.redeem(room, token)
        self.assertEqual(result.status_code, 200)
        self.assertAlmostEqual(result.json()['session_expires'] - self.now[0], PLAYER_TTL)
        cookie = result.headers['set-cookie'].lower()
        self.assertIn('httponly', cookie)
        self.assertIn('max-age=86400', cookie)
        self.assertIn('samesite=lax', cookie)
        self.now[0] += 601
        self.assertEqual(self.guest.get(f'{BASE}/{room["id"]}').status_code, 200)
        self.now[0] += PLAYER_TTL - 602
        self.assertEqual(self.guest.get(f'{BASE}/{room["id"]}').status_code, 200)
        self.now[0] += 2
        self.assertNotEqual(self.guest.get(f'{BASE}/{room["id"]}').status_code, 200)

    def test_unused_invite_expires_and_rotation_revokes_previous(self):
        room, old = self.create()
        new = self.host.post(f'{BASE}/{room["id"]}/invite').json()
        self.assertEqual(self.redeem(room, old).status_code, 410)
        token = parse_qs(urlsplit(new['url']).fragment)['invite'][0]
        self.now[0] += 601
        self.assertEqual(self.redeem(room, token).status_code, 410)

    def test_guest_cannot_access_other_anka_capabilities(self):
        room, token = self.create()
        self.assertEqual(self.redeem(room, token).status_code, 200)
        self.assertIsNone(self.guest.get('/api/auth/me').json()['username'])
        for path in ['/api/settings', '/api/apps', '/api/plugins',
                     '/api/sync/index', '/plugins/test-game/secret.py',
                     '/plugins/other-game/dist/game.js']:
            self.assertEqual(self.guest.get(path).status_code, 401, path)
        self.assertEqual(self.guest.post(BASE, json={}).status_code, 401)
        self.assertEqual(self.guest.get('/plugins/test-game/dist/game.js').status_code, 200)
        self.assertEqual(self.guest.get(f'/play/test-game/{room["id"]}').status_code, 200)
        self.assertEqual(self.guest.get(f'{BASE}/wrong-room').status_code, 404)
        denied = self.guest.post(f'{BASE}/{room["id"]}/command',
                                 json={'action': 'map', 'args': {'map': 'snow'}})
        self.assertEqual(denied.status_code, 403)

    def test_get_link_does_not_consume_and_redeem_is_atomic(self):
        room, token = self.create()
        for _ in range(2):
            self.assertEqual(self.guest.get(f'/join/test-game/{room["id"]}').status_code, 200)
        def claim_without_lifespan(_):
            client = TestClient(app, headers=ORIGIN)
            try:
                return self.redeem(room, token, client).status_code
            finally:
                client.close()
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(claim_without_lifespan, range(2)))
        self.assertEqual(sorted(statuses), [200, 409])

    def test_origin_and_revocation(self):
        self.assertEqual(self.host.post(BASE, json={}, headers={'origin': 'https://evil.test'}).status_code, 403)
        room, token = self.create()
        self.redeem(room, token)
        self.host.post(f'{BASE}/{room["id"]}/command', json={'action': 'kick'})
        self.assertEqual(self.guest.get(f'{BASE}/{room["id"]}').status_code, 403)
        self.assertEqual(self.guest.get('/plugins/test-game/dist/game.js').status_code, 401)

    def test_websocket_membership_build_and_guest_authority(self):
        room, token = self.create()
        rid = room['id']
        self.redeem(room, token)
        path = f'{BASE}/{rid}/ws'
        with self.assertRaises(WebSocketDisconnect):
            anonymous = TestClient(app, headers=ORIGIN)
            with anonymous.websocket_connect(path, headers=ORIGIN):
                pass
        hello = {'type': 'hello', 'build': 'test-build', 'protocol': 1, 'round': ''}
        with self.host.websocket_connect(path, headers=ORIGIN) as host_ws:
            host_ws.send_json(hello)
            self.assertEqual(host_ws.receive_json()['type'], 'room')
            with self.guest.websocket_connect(path, headers=ORIGIN) as guest_ws:
                guest_ws.send_json(hello)
                self.assertEqual(guest_ws.receive_json()['type'], 'room')
                host_ws.receive_json()
                for client in [self.host, self.guest]:
                    self.assertEqual(client.post(f'{BASE}/{rid}/command', json={
                        'action': 'ready', 'args': {'ready': True}}).status_code, 200)
                self.assertEqual(self.guest.post(f'{BASE}/{rid}/command', json={'action': 'start'}).status_code, 403)
                self.assertEqual(self.host.post(f'{BASE}/{rid}/command', json={'action': 'start'}).status_code, 200)
                actual = self.hub.rooms[rid]
                for client in [self.host, self.guest]:
                    self.assertEqual(client.post(f'{BASE}/{rid}/command', json={
                        'action': 'loaded', 'args': {'round': actual['round']}}).status_code, 200)
                self.now[0] += 4
                guest_ws.send_json({'type': 'ping', 'sent': 1})
                while guest_ws.receive_json()['type'] != 'pong':
                    pass
                guest_ws.send_json({'type': 'game', 'round': actual['round'],
                                    'payload': {'type': 'action', 'id': room['host'], 'action': 'shot'}})
                while True:
                    frame = host_ws.receive_json()
                    if frame['type'] == 'game':
                        break
                self.assertNotEqual(frame['from'], room['host'])
                guest_ws.send_json({'type': 'game', 'round': actual['round'],
                                    'payload': {'type': 'pvp-state', 'players': []}})
                with self.assertRaises(WebSocketDisconnect):
                    while True:
                        guest_ws.receive_json()

    def test_websocket_uses_player_expiry_not_invitation_expiry(self):
        room, token = self.create()
        self.redeem(room, token)
        with self.guest.websocket_connect(f'{BASE}/{room["id"]}/ws', headers=ORIGIN) as ws:
            ws.send_json({'type': 'hello', 'build': 'test-build', 'protocol': 1, 'round': ''})
            self.assertEqual(ws.receive_json()['type'], 'room')
            self.now[0] += 601
            ws.send_json({'type': 'ping', 'sent': 7})
            self.assertEqual(ws.receive_json()['type'], 'pong')
            self.now[0] += PLAYER_TTL
            ws.send_json({'type': 'ping', 'sent': 8})
            with self.assertRaises(WebSocketDisconnect):
                while True:
                    ws.receive_json()

    def test_wrong_build_cannot_enter_websocket(self):
        room, token = self.create()
        self.redeem(room, token)
        with self.guest.websocket_connect(f'{BASE}/{room["id"]}/ws', headers=ORIGIN) as ws:
            ws.send_json({'type': 'hello', 'build': 'obsolete', 'protocol': 1, 'round': ''})
            with self.assertRaises(WebSocketDisconnect) as error:
                ws.receive_json()
            self.assertEqual(error.exception.code, 4409)


if __name__ == '__main__':
    unittest.main()
