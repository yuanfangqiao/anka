"""Queue pressure and hostile/competing input must not create stuck controls."""
import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
import unittest

from app.devices.channel import Channel
from app.devices.protocol import DeviceError, control, decode, feedback, neutral
from app.devices.service import DeviceService
from app.devices.logging import RedactDeviceTokens


def frame(seq=1, yaw=0, fire=False):
    return {'type': 'input', 'seq': seq, 'move': {'x': 0, 'y': 0},
            'look': {'yaw': yaw, 'pitch': 0}, 'buttons': {'fire': fire, 'aim': False},
            'pressedFire': fire}


class DeviceProtocolTests(unittest.TestCase):
    def test_query_and_debug_frame_credentials_are_redacted(self):
        for value in ['/v1/device/join?bindKey=public&token=secret',
                      '/v1/device/reconnect?deviceId=public&token%3Dsecret',
                      '''WS TEXT {"type":"bound","resumeToken":"secret"}''']:
            record = logging.LogRecord('uvicorn.error', 20, '', 1, '%s', (value,), None)
            RedactDeviceTokens().filter(record)
            self.assertNotIn('secret', record.getMessage())

    def test_invalid_numbers_shapes_and_sequences(self):
        for raw in ['[]', '{"value":NaN}', '{"value":Infinity}', '{', '"'+'x'*4096+'"']:
            with self.assertRaises(DeviceError):
                decode(raw)
        for value in [float('inf'), float('nan'), True, 46, '1', 10**1000]:
            value_frame = frame(); value_frame['look']['yaw'] = value
            with self.assertRaises(DeviceError):
                control(value_frame, 0)
        for action in [[], {}, None]:
            with self.assertRaises(DeviceError):
                control({'type': 'action', 'seq': 1, 'action': action}, 0)
        value = frame(); value['move'] = {'x': 1, 'y': 1}
        with self.assertRaises(DeviceError):
            control(value, 0)
        self.assertIsNone(control(frame(2), 2))
        self.assertEqual(control(frame(3), 2)['seq'], 3)
        self.assertEqual(feedback({'type': 'ack', 'seq': 3, 'status': 'submitted'})['status'], 'submitted')

    def test_rounded_unit_vectors_and_absolute_pose(self):
        value = frame(); value['move'] = {'x': .01, 'y': 1}
        value['pose'] = {'id': 1, 'q': [1, 0, 0, 0]}
        result = control(value, 0)
        self.assertAlmostEqual(sum(v*v for v in result['move'].values()), 1)
        self.assertEqual(result['pose']['q'], [1, 0, 0, 0])
        for pose in [{'id': True, 'q': [1,0,0,0]}, {'id': 1, 'q': [0,0,0,0]},
                     {'id': 1, 'q': [1,0,0,float('nan')]}, {'id': 1, 'q': [1,0,0]},
                     {'id': 1, 'q': [1,0,0,0], 'gain': 4}]:
            value['pose'] = pose
            with self.assertRaises(DeviceError): control(value, 0)

    def test_manual_turn_is_bounded_absolute_state(self):
        value = frame(); value['turn'] = 45
        self.assertEqual(control(value, 0)['turn'], 45)
        self.assertTrue(neutral(control(value, 0)), 'absolute orientation is not a held turn command')
        self.assertEqual(control(frame(), 0)['turn'], 0)
        for bad in [181, -181, True, float('nan'), '10', {}]:
            value['turn'] = bad
            with self.assertRaises(DeviceError): control(value, 0)

    def test_complete_turn_total_preserves_full_rotations(self):
        value = frame(); value['turnTotal'] = 765
        self.assertEqual(control(value, 0)['turnTotal'], 765)
        self.assertTrue(neutral(control(value, 0)))
        self.assertNotIn('turnTotal', control(frame(), 0), 'legacy wrapped-only clients stay compatible')
        for bad in [1_000_000_001, -1_000_000_001, True, float('nan'), float('inf'), '60', {}]:
            value['turnTotal'] = bad
            with self.assertRaises(DeviceError): control(value, 0)

    def test_pair_can_only_be_consumed_once_under_contention(self):
        service = DeviceService(clock=lambda: 1000)
        service.register('game')
        class Sink:
            def put(self, _):
                pass
        receiver = service.add_receiver(dict(key=('game', 'solo', 'player'), app='game',
            runtime='test-runtime', name='player', expires=5000, valid=lambda: True), Sink())
        key, token, _ = service.pair(receiver)
        def join(_):
            try:
                service.join(key, token, Sink())
                return 'bound'
            except DeviceError as error:
                return error.code
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(join, range(16)))
        self.assertEqual(results.count('bound'), 1)
        self.assertEqual(results.count('pair_used'), 15)
        service.close()


class ChannelTests(unittest.IsolatedAsyncioTestCase):
    async def test_coalescing_preserves_rotation_and_short_fire_edge(self):
        queue = Channel()
        first, second = frame(1, 10, True), frame(2, 5, False)
        first['pose'] = {'id': 1, 'q': [.7071068,0,.7071068,0]}
        second['pose'] = {'id': 1, 'q': [1,0,0,0]}
        first['turn'], second['turn'] = 30, 45
        first['turnTotal'], second['turnTotal'] = 390, 765
        queue.put(first); queue.put(second)
        await asyncio.sleep(0)
        actual = await queue.get()
        self.assertEqual(actual['seq'], 2)
        self.assertEqual(actual['turn'], 45, 'coalescing keeps latest absolute turn, never sums it')
        self.assertEqual(actual['turnTotal'], 765, 'full turn count survives queue coalescing')
        self.assertEqual(actual['pose'], second['pose'])
        self.assertEqual(actual['look']['yaw'], 15)
        self.assertFalse(actual['buttons']['fire'])
        self.assertTrue(actual['pressedFire'])

    async def test_release_clears_stale_actions_and_pressure_is_bounded(self):
        queue = Channel()
        queue.put(frame()); queue.put({'type': 'action', 'action': 'jump', 'seq': 2})
        queue.put({'type': 'release', 'reason': 'disconnected'})
        await asyncio.sleep(0)
        self.assertEqual((await queue.get())['type'], 'release')
        for _ in range(40):
            queue.put({'type': 'ack', 'seq': 1, 'status': 'applied'})
        await asyncio.sleep(0)
        self.assertLessEqual(len(queue.frames), 32)
        self.assertEqual((await queue.get())['code'], 'slow_receiver')
