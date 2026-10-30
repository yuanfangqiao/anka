"""GATT must keep local input separate from User/Share/Device authority."""
import unittest
import time
from app.devices.service import DeviceService
from app.devices.protocol import DeviceError


class Sink:
    def __init__(self): self.frames = []
    def put(self, value): self.frames.append(value)


class GattTests(unittest.TestCase):
    def setUp(self):
        self.service = DeviceService(clock=lambda: 1000)
        self.service.register('game')
        self.channel = Sink()
        self.receiver = self.receiver_for('owner', self.channel)

    def receiver_for(self, identity, channel):
        return self.service.add_receiver(dict(key=('game', 'solo', identity), app='game',
            runtime=identity+'-runtime', name=identity, auth_key=identity, expires=5000, valid=lambda: True), channel)

    def bind(self):
        key, token, _ = self.service.pair(self.receiver)
        return self.service.gatt(self.receiver, self.channel, {'type': 'gatt_bind', 'bindKey': key, 'token': token, 'requestId': '1'})

    def test_only_exact_player_can_consume_pair(self):
        key, token, _ = self.service.pair(self.receiver)
        other = self.receiver_for('guest', Sink())
        with self.assertRaises(DeviceError):
            self.service.gatt(other, other['channel'], {'type': 'gatt_bind', 'bindKey': key, 'token': token})
        self.assertFalse(self.service.pairings[key]['used'])
        self.assertEqual(self.bind()['type'], 'gatt_authorized')

    def test_single_owner_and_transport_separation(self):
        reply = self.bind()
        self.assertFalse(reply['active'])
        with self.assertRaises(DeviceError): self.service.pair(self.receiver)
        with self.assertRaises(DeviceError): self.service.reconnect(reply['deviceId'], reply['resumeToken'], Sink())
        with self.assertRaises(DeviceError): self.service.gatt(self.receiver, Sink(), {'type': 'gatt_lease'})

    def test_expiry_detach_resume_revoke(self):
        reply = self.bind();binding = self.service.bindings[self.receiver['key']]
        binding['lease_until'] = time.monotonic()-1
        self.service.gatt_expire(binding)
        self.assertIsNone(binding['channel'])
        resumed = self.service.gatt(self.receiver, self.channel, {'type': 'gatt_resume', 'deviceId': reply['deviceId'], 'token': reply['resumeToken']})
        self.assertEqual(resumed['deviceId'], reply['deviceId'])
        self.receiver['active'] = True
        self.assertTrue(self.service.gatt(self.receiver, self.channel, {'type': 'gatt_lease'})['active'])
        self.service.revoke(self.receiver)
        self.assertTrue(any(f['type']=='gatt_revoked' for f in self.channel.frames))
        with self.assertRaises(DeviceError): self.service.gatt(self.receiver, self.channel, {'type': 'gatt_lease'})

    def test_old_receiver_cannot_detach_new_owner(self):
        reply = self.bind();next_channel = Sink()
        self.service.gatt(self.receiver, next_channel, {'type': 'gatt_resume', 'deviceId': reply['deviceId'], 'token': reply['resumeToken']})
        self.service.gatt_lost(self.receiver, self.channel)
        self.assertIs(self.service.bindings[self.receiver['key']]['channel'].owner, next_channel)

    def test_ws_binding_cannot_be_resumed_as_gatt(self):
        key, token, _ = self.service.pair(self.receiver)
        binding, secret = self.service.join(key, token, Sink())
        with self.assertRaises(DeviceError): self.service.gatt(self.receiver, self.channel, {'type': 'gatt_resume', 'deviceId': binding['deviceId'], 'token': secret})

    def test_direct_bluetooth_binding_needs_no_qr(self):
        result = self.service.gatt(self.receiver, self.channel, {'type': 'gatt_bind'})
        self.assertEqual(result['type'], 'gatt_authorized')
        self.assertEqual(self.service.pairings, {})
        with self.assertRaises(DeviceError): self.service.gatt(self.receiver, self.channel, {'type': 'gatt_bind'})

    def test_resume_cannot_take_another_players_device(self):
        self.bind()
        other = self.receiver_for('guest', Sink())
        result = self.service.gatt(other, other['channel'], {'type': 'gatt_bind'})
        with self.assertRaises(DeviceError):
            self.service.gatt(self.receiver, self.channel, {'type': 'gatt_resume', 'deviceId': result['deviceId'], 'token': result['resumeToken']})
        self.assertIs(self.service.bindings[other['key']]['channel'].owner, other['channel'])
