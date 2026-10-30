"""Actual authenticated HTTP/WS handshake for the local BLE data plane."""
import unittest
from urllib.parse import parse_qs, urlsplit
import test_devices as existing


class GattSocketTests(unittest.TestCase):
    setUp = existing.DeviceBoundaryTests.setUp
    tearDown = existing.DeviceBoundaryTests.tearDown
    pair = existing.DeviceBoundaryTests.pair

    def test_real_bind_lease_detach_resume_and_revoke(self):
        with self.user.websocket_connect(existing.RECEIVER) as socket:
            existing.receive(socket, 'receiver_ready')
            socket.send_json({'type': 'receiver', 'active': True})
            query = parse_qs(urlsplit(self.pair()).query)
            socket.send_json({'type': 'gatt_bind', 'bindKey': query['bindKey'][0], 'token': query['token'][0], 'requestId': 'bind'})
            bound = existing.receive(socket, 'gatt_authorized')
            self.assertTrue(bound['active'])
            socket.send_json({'type': 'gatt_lease', 'requestId': 'lease'})
            self.assertEqual(existing.receive(socket, 'gatt_authorized')['requestId'], 'lease')
            socket.send_json({'type': 'gatt_detach', 'requestId': 'detach'})
            existing.receive(socket, 'gatt_detached')
            socket.send_json({'type': 'gatt_resume', 'deviceId': bound['deviceId'], 'token': bound['resumeToken'], 'requestId': 'resume'})
            self.assertEqual(existing.receive(socket, 'gatt_authorized')['deviceId'], bound['deviceId'])
            result = self.user.post(existing.BASE+'/unbind', json={'runtime': existing.RUNTIME})
            self.assertEqual(result.status_code, 200)
            existing.receive(socket, 'gatt_revoked')
            socket.send_json({'type': 'gatt_lease', 'requestId': 'after-revoke'})
            self.assertEqual(existing.receive(socket, 'gatt_error')['code'], 'invalid_token')

    def test_invalid_device_proof_does_not_close_owner_socket(self):
        with self.user.websocket_connect(existing.RECEIVER) as socket:
            existing.receive(socket, 'receiver_ready')
            query = parse_qs(urlsplit(self.pair()).query)
            socket.send_json({'type': 'gatt_bind', 'bindKey': query['bindKey'][0], 'token': 'wrong', 'requestId': 'bad'})
            self.assertEqual(existing.receive(socket, 'gatt_error')['code'], 'invalid_token')
            socket.send_json({'type': 'ping', 't': 123})
            self.assertEqual(existing.receive(socket, 'pong')['t'], 123)
