"""Regression tests for cutover during an awaited read and queue overflow close."""
import asyncio
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from app.devices.protocol import DeviceError
from app.devices.channel import Channel
from app.devices.service import DeviceService
from app.devices.transport import device_socket, sender


class Socket:
    headers = {}
    client = SimpleNamespace(host='127.0.0.1')

    def __init__(self, params=None):
        self.query_params = params or {}
        self.application_state = SimpleNamespace(name='CONNECTING')
        self.sent, self.closed = [], False

    async def accept(self):
        self.application_state.name = 'CONNECTED'

    async def send_json(self, frame):
        self.sent.append(frame)

    async def close(self, *args):
        self.closed = True


class LifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_revoked_socket_close_cannot_restore_or_release_a_new_binding(self):
        service = DeviceService(clock=lambda: 1000)
        service.register('game')
        delivered = []
        receiver = service.add_receiver(dict(key=('game', 'solo', 'player'),
            app='game', runtime='runtime-test', name='Player', expires=5000,
            valid=lambda: True), SimpleNamespace(put=delivered.append))
        key, token, _ = service.pair(receiver)
        old_channel = Channel()
        old, _ = service.join(key, token, old_channel)
        service.revoke(receiver)
        delivered.clear()
        service.detach(old, old_channel)
        self.assertEqual(delivered, [])
        key, token, _ = service.pair(receiver)
        new_channel = Channel()
        current, _ = service.join(key, token, new_channel)
        delivered.clear()
        service.detach(old, old_channel)
        self.assertEqual(delivered, [])
        self.assertIs(service.bindings[receiver['key']], current)
        self.assertIs(current['channel'], new_channel)
        service.close()

    async def test_receiver_reclaims_binding_and_late_close_cannot_detach_new_socket(self):
        service = DeviceService(clock=lambda: 1000); service.register('game')
        target = dict(key=('game','solo','player'), app='game', runtime='runtime-1',
                      auth_key='same-authority', name='Player', expires=5000, valid=lambda: True)
        old_channel, device_channel, new_channel = Channel(), Channel(), Channel()
        receiver = service.add_receiver(target, old_channel)
        key, token, _ = service.pair(receiver)
        binding, secret = service.join(key, token, device_channel)
        binding['armed'] = True; receiver['active'] = True
        service.detach_receiver(receiver, old_channel)
        self.assertFalse(binding['armed']); self.assertFalse(receiver['active'])
        with self.assertRaises(DeviceError):
            service.add_receiver(dict(target, auth_key='other-authority'), new_channel)
        recovered = service.add_receiver(dict(target, runtime='runtime-2'), new_channel)
        self.assertIs(recovered, receiver); self.assertIs(service.bindings[receiver['key']], binding)
        service.detach_receiver(receiver, old_channel)
        self.assertFalse(receiver['detached']); self.assertIs(receiver['channel'], new_channel)
        self.assertEqual((await device_channel.get())['type'], 'rearm')
        self.assertEqual(service.reconnect(binding['deviceId'], secret, Channel())[0]['deviceId'], binding['deviceId'])
        service.close()

    async def test_displaced_socket_cannot_write_after_awaited_read(self):
        service = DeviceService(clock=lambda: 1000)
        service.register('game')
        sink = SimpleNamespace(put=lambda frame: delivered.append(frame))
        delivered = []
        receiver = service.add_receiver(dict(key=('game', 'solo', 'player'),
            app='game', runtime='runtime-test', name='Player', expires=5000,
            valid=lambda: True), sink)
        receiver['active'] = True
        key, token, _ = service.pair(receiver)
        socket = Socket({'bindKey': key, 'token': token})
        replacement = Channel()
        binding = None

        async def reconnect_during_read(_):
            nonlocal binding
            binding = service.bindings[receiver['key']]
            # Replace ownership during the exact awaited read boundary.
            service.reconnect(binding['deviceId'], socket.sent[0]['resumeToken'], replacement)
            return {'type': 'input', 'seq': 999, 'move': {'x': 0, 'y': 0},
                    'look': {'yaw': 0, 'pitch': 0}, 'buttons': {'aim': False, 'fire': False}}

        with patch('app.devices.transport.hub', return_value=service), \
             patch('app.devices.transport.Reader.read', reconnect_during_read):
            await asyncio.wait_for(device_socket(socket), 1)
        self.assertIs(binding['channel'], replacement)
        self.assertEqual(binding['seq'], 0)
        self.assertFalse(any(frame['type'] == 'input' for frame in delivered))
        service.close()

    async def test_overflow_sends_close_instead_of_silently_stopping_sender(self):
        channel, socket = Channel(), Socket()
        channel.closed = True
        await sender(socket, channel)
        self.assertEqual(socket.sent[-1]['code'], 'slow_receiver')
        self.assertTrue(socket.closed)
