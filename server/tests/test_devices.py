"""Real device HTTP/WS boundary, independent User/Share authorization and stop semantics."""
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
from app.devices.service import DeviceService
from app.main import app
from app.rooms.service import COOKIE, RoomService
from app.rooms.transport import RoomBus

ORIGIN = {'origin': 'http://testserver'}
RUNTIME = 'runtime-controller-test'
BASE = '/api/devices/user/test-game'
RECEIVER = BASE + '/receiver/ws?runtime=' + RUNTIME


def input_frame(seq, fire=False, move=0):
    return {'type': 'input', 'seq': seq, 'move': {'x': move, 'y': 0},
            'look': {'yaw': 0, 'pitch': 0}, 'buttons': {'fire': fire, 'aim': False}}


def receive(ws, kind):
    for _ in range(30):
        frame = ws.receive_json()
        if frame['type'] == kind:
            return frame
    raise AssertionError('Missing ' + kind)


class DeviceBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.now = [time.time()]
        self.devices = DeviceService(clock=lambda: self.now[0])
        self.devices.register('test-game')
        self.rooms = RoomService(Path(self.tmp.name)/'rooms.db', clock=lambda: self.now[0])
        self.rooms.bus = RoomBus(self.rooms)
        self.rooms.register('test-game', lambda: dict(build='test', protocol=1,
                            maps=['desert'], characters=['male', 'female']))
        services = {'devices': self.devices, 'rooms': self.rooms}
        self.patches = [patch.object(deps, 'manager', SimpleNamespace(ctx=SimpleNamespace(get=services.get))),
                        patch.object(auth, '_secret_cache', b'device-tests-only'),
                        patch.object(auth, 'DEBUG_DISABLE_AUTH', False),
                        patch.object(settings, 'ROOM_PUBLIC_URL', '')]
        for item in self.patches:
            item.start()
        self.user, self.anon, self.share = [TestClient(app, headers=ORIGIN) for _ in range(3)]
        self.user.cookies.set(auth.COOKIE_NAME, auth.create_session('owner'))

    def tearDown(self):
        for client in (self.user, self.anon, self.share):
            client.close()
        self.devices.close()
        self.rooms.close()
        for item in reversed(self.patches):
            item.stop()
        self.tmp.cleanup()

    def pair(self, base=BASE, client=None, room=''):
        response = (client or self.user).post(base+'/pairings', json={'runtime': RUNTIME, 'room': room})
        self.assertEqual(response.status_code, 200, response.text)
        return urlsplit(response.json()['wsUrl']).path+'?'+urlsplit(response.json()['wsUrl']).query

    def test_public_get_does_not_consume_and_cookie_cannot_authenticate_device(self):
        with self.user.websocket_connect(RECEIVER) as receiver:
            receive(receiver, 'receiver_ready')
            path = self.pair()
            for _ in range(2):
                result = self.anon.get(path)
                self.assertEqual(result.status_code, 200)
                self.assertEqual(result.headers['cache-control'], 'no-store')
            with self.assertRaises(WebSocketDisconnect):
                with self.user.websocket_connect('/v1/device/join'):
                    pass
            with self.anon.websocket_connect(path) as device:
                self.assertEqual(receive(device, 'bound')['inputHz'], 60)
                self.assertEqual(self.anon.get('/api/apps').status_code, 401)
                self.assertEqual(self.anon.get('/api/settings').status_code, 401)

    def test_binary_control_frame_is_rejected_cleanly(self):
        with self.user.websocket_connect(RECEIVER) as receiver:
            receive(receiver, 'receiver_ready')
            with self.anon.websocket_connect(self.pair()) as device:
                receive(device, 'bound')
                device.send_bytes(b'{}')
                self.assertEqual(receive(device, 'error')['code'], 'invalid_message')

    def test_real_input_action_feedback_and_timeout(self):
        with self.user.websocket_connect(RECEIVER) as receiver:
            receive(receiver, 'receiver_ready')
            receiver.send_json({'type': 'receiver', 'active': True})
            with self.anon.websocket_connect(self.pair()) as device:
                receive(device, 'bound')
                device.send_json(input_frame(1))
                device.send_json(input_frame(2, fire=True, move=.5))
                frame = receive(receiver, 'input')
                if frame['seq'] == 1:
                    frame = receive(receiver, 'input')
                self.assertEqual(frame['move']['x'], .5)
                self.assertTrue(frame['buttons']['fire'])
                device.send_json({'type': 'action', 'seq': 3, 'action': 'jump', 'playerId': 'someone-else'})
                frame = receive(receiver, 'action')
                self.assertEqual(frame['action'], 'jump')
                self.assertNotIn('playerId', frame)
                receiver.send_json({'type': 'ack', 'seq': 3, 'status': 'applied'})
                self.assertEqual(receive(device, 'ack')['status'], 'applied')
                # Only application pings continue: they cannot keep fire held.
                time.sleep(.22)
                device.send_json({'type': 'ping', 'id': 1, 't': 7})
                self.assertEqual(receive(device, 'pong')['t'], 7)
                self.assertEqual(receive(receiver, 'release')['reason'], 'input_timeout')

    def test_one_binding_single_use_rotation_and_revocation(self):
        with self.user.websocket_connect(RECEIVER) as receiver:
            receive(receiver, 'receiver_ready')
            old, path = self.pair(), self.pair()
            with self.assertRaises(WebSocketDisconnect):
                with self.anon.websocket_connect(old):
                    pass
            with self.anon.websocket_connect(path) as device:
                receive(device, 'bound')
                with self.assertRaises(WebSocketDisconnect):
                    with self.share.websocket_connect(path):
                        pass
                response = self.user.post(BASE+'/pairings', json={'runtime': RUNTIME})
                self.assertEqual(response.status_code, 409)
                self.assertEqual(self.user.post(BASE+'/unbind', json={'runtime': RUNTIME}).status_code, 200)
                self.assertIn(receive(device, 'closed')['code'], ('binding_revoked', 'game_unavailable'))

    def test_reconnect_independent_secret_and_neutral_gate(self):
        with self.user.websocket_connect(RECEIVER) as receiver:
            receive(receiver, 'receiver_ready')
            receiver.send_json({'type': 'receiver', 'active': True})
            with self.anon.websocket_connect(self.pair()) as device:
                bound = receive(device, 'bound')
            path = f'/v1/device/reconnect?deviceId={bound["deviceId"]}&token={bound["resumeToken"]}'
            with self.anon.websocket_connect(path) as device:
                self.assertEqual(receive(device, 'bound')['deviceId'], bound['deviceId'])
                device.send_json(input_frame(1, fire=True))  # Ignored until neutral.
                device.send_json(input_frame(2))
                device.send_json({'type': 'action', 'seq': 3, 'action': 'reload'})
                self.assertEqual(receive(receiver, 'action')['seq'], 3)
                self.user.post('/api/auth/logout')
                self.assertIn(receive(device, 'closed')['code'], ('game_unavailable', 'binding_revoked'))
            with self.assertRaises(WebSocketDisconnect):
                with self.anon.websocket_connect(path):
                    pass

    def test_share_can_only_authorize_own_room_and_no_user_fallback(self):
        room, invite = self.rooms.create('test-game', 'owner', '主人', 'male', 'desert')
        _, token, _ = self.rooms.redeem('test-game', room['id'], invite['token'], '好友')
        self.share.cookies.set(COOKIE, token)
        base = '/api/devices/share/test-game'
        path = base+'/receiver/ws?runtime='+RUNTIME+'&room='+room['id']
        with self.share.websocket_connect(path) as receiver:
            receive(receiver, 'receiver_ready')
            join = self.pair(base, self.share, room['id'])
            with self.anon.websocket_connect(join) as device:
                receive(device, 'bound')
                self.assertEqual(self.share.post(BASE+'/pairings', json={'runtime': RUNTIME}).status_code, 401)
                actor = self.rooms.store.visitor(token, self.now[0])['player']
                self.rooms.store.revoke(room['id'], actor)
                self.assertIn(receive(device, 'closed')['code'], ('binding_revoked', 'game_unavailable'))

    def test_expired_pair_and_wrong_origin(self):
        with self.user.websocket_connect(RECEIVER) as receiver:
            receive(receiver, 'receiver_ready')
            path = self.pair()
            with self.assertRaises(WebSocketDisconnect):
                with self.anon.websocket_connect(path, headers={'origin': 'https://evil.test'}):
                    pass
            self.now[0] += 121
            with self.assertRaises(WebSocketDisconnect):
                with self.anon.websocket_connect(path):
                    pass


if __name__ == '__main__':
    unittest.main()
