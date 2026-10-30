"""In-memory device authority. One player, one binding, one active connection."""
import hashlib
import secrets
import threading
import time

from .protocol import INPUT_TIMEOUT, fail
from .gatt import GattBindings


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


class DeviceService(GattBindings):
    def __init__(self, clock=time.time):
        self.clock, self.lock = clock, threading.RLock()
        self.apps, self.receivers, self.pairings, self.bindings = {}, {}, {}, {}
        self.attempts, self.stopped = {}, False

    def register(self, app):
        with self.lock:
            self.apps[app] = True

        def dispose():
            with self.lock:
                self.apps.pop(app, None)
                for key, receiver in list(self.receivers.items()):
                    if receiver['app'] == app:
                        self.remove_receiver(key, receiver)
        return dispose

    def throttle(self, key, limit=20):
        with self.lock:
            now = self.clock()
            self.attempts = {k: v for k, v in self.attempts.items() if now-v[0] < 60}
            if len(self.attempts) > 4096 and key not in self.attempts:
                fail('rate_limited', '请求过多，请稍后再试', 429)
            started, count = self.attempts.get(key, (now, 0))
            if count >= limit:
                fail('rate_limited', '请求过多，请稍后再试', 429)
            self.attempts[key] = (started, count + 1)

    def check(self, receiver):
        if self.stopped or receiver['app'] not in self.apps:
            fail('game_unavailable', '游戏设备服务已停止', 410)
        if self.receivers.get(receiver['key']) is not receiver:
            fail('game_unavailable', '游戏页面已关闭', 410)
        if receiver['expires'] <= self.clock() or not receiver['valid']():
            fail('binding_revoked', '玩家授权已失效', 403)

    def add_receiver(self, target, channel):
        with self.lock:
            if self.stopped or target['app'] not in self.apps:
                fail('game_unavailable', '游戏尚未启用设备接入', 404)
            self.sweep()
            old = self.receivers.get(target['key'])
            if old:
                # Reclaim only with the same authenticated authority after socket loss.
                if not old.get('detached') or old['auth_key'] != target['auth_key']:
                    fail('receiver_exists', '此玩家已在另一游戏页面接入手柄', 409)
                old.update(target, channel=channel, active=False, detached=0, seen=time.monotonic())
                binding = self.bindings.get(old['key'])
                if binding:
                    self.release(binding, 'receiver_reconnected')
                    self.publish(binding)
                    if binding['channel']:
                        binding['channel'].put({'type': 'rearm'})
                return old
            if len(self.receivers) >= 256:
                fail('rate_limited', '设备接收端已满', 429)
            receiver = dict(target, channel=channel, active=False, seen=time.monotonic())
            self.receivers[target['key']] = receiver
            return receiver

    def receiver(self, target, runtime):
        receiver = self.receivers.get(target['key'])
        if not receiver or receiver['runtime'] != runtime:
            fail('game_unavailable', '请先连接当前游戏页面', 409)
        self.check(receiver)
        return receiver

    def pair(self, receiver):
        with self.lock:
            self.check(receiver)
            self.sweep()
            if receiver['key'] in self.bindings:
                fail('player_already_bound', '请先解除原手柄绑定', 409)
            for key, item in list(self.pairings.items()):
                if item['receiver'] is receiver:
                    self.pairings.pop(key, None)
            key, token = secrets.token_urlsafe(16), secrets.token_urlsafe(32)
            expires = min(receiver['expires'], self.clock()+120)
            self.pairings[key] = dict(hash=digest(token), expires=expires,
                                      receiver=receiver, used=False)
            return key, token, expires

    def join(self, key, token, channel, *, transport='websocket', receiver=None):
        with self.lock:
            item = self.pairings.get(key)
            if not item or item['expires'] <= self.clock():
                fail('pair_expired', '二维码已过期，请重新扫码', 410)
            if not secrets.compare_digest(item['hash'], digest(token)):
                fail('invalid_token', '设备配对凭证无效', 403)
            if item['used']:
                fail('pair_used', '二维码已使用，请重新生成', 409)
            if receiver is not None and receiver is not item['receiver']:
                fail('wrong_principal', '二维码不属于当前玩家或游戏', 403)
            receiver = item['receiver']
            self.check(receiver)
            if receiver['key'] in self.bindings:
                fail('player_already_bound', '当前玩家已连接一个手柄', 409)
            binding, secret = self.create_binding(receiver, channel, transport=transport)
            item['used'] = True
            return binding, secret

    def create_binding(self, receiver, channel, *, transport):
        self.check(receiver)
        if receiver['key'] in self.bindings:
            fail('player_already_bound', '当前玩家已连接一个手柄', 409)
        secret = secrets.token_urlsafe(32)
        binding = dict(deviceId='dev_'+secrets.token_urlsafe(12), receiver=receiver,
                       hash=digest(secret), expires=min(receiver['expires'], self.clock()+43200),
                       channel=channel, transport=transport, armed=False, last_input=0., seq=0, fire=False)
        self.bindings[receiver['key']] = binding
        self.publish(binding)
        return binding, secret

    def reconnect(self, device, token, channel, *, transport='websocket'):
        with self.lock:
            binding = next((b for b in self.bindings.values() if b['deviceId'] == device), None)
            if (not isinstance(token, str) or not binding or binding.get('transport', 'websocket') != transport
                    or not secrets.compare_digest(binding['hash'], digest(token))):
                fail('invalid_token', '手柄会话已失效，请重新扫码', 403)
            self.check_binding(binding)
            old = binding['channel']
            if old:
                old.put({'type': 'closed', 'code': 'replaced', 'message': '设备已重连'})
            self.release(binding, 'reconnecting')
            binding.update(channel=channel, seq=0)
            self.publish(binding)
            return binding, token

    def check_binding(self, binding):
        self.check(binding['receiver'])
        if (binding['expires'] <= self.clock() or
                self.bindings.get(binding['receiver']['key']) is not binding):
            fail('binding_revoked', '手柄绑定已失效，请重新扫码', 403)

    def publish(self, binding):
        binding['receiver']['channel'].put({'type': 'binding',
            'deviceId': binding['deviceId'], 'connected': bool(binding['channel']),
            'transport': binding.get('transport', 'websocket')})

    def release(self, binding, reason):
        binding.update(armed=False, fire=False, last_input=0.)
        binding['receiver']['channel'].put({'type': 'release', 'reason': reason})

    def detach(self, binding, channel):
        with self.lock:
            if (self.bindings.get(binding['receiver']['key']) is binding and
                    binding.get('channel') is channel):
                binding['channel'] = None
                self.release(binding, 'disconnected')
                self.publish(binding)

    def revoke(self, receiver, reason='binding_revoked'):
        with self.lock:
            binding = self.bindings.pop(receiver['key'], None)
            if binding:
                self.release(binding, reason)
                if binding['channel']:
                    binding['channel'].put({'type': 'closed', 'code': reason,
                                            'message': '手柄绑定已解除'})
                receiver['channel'].put({'type': 'binding', 'deviceId': '', 'connected': False})
            for key, item in list(self.pairings.items()):
                if item['receiver'] is receiver:
                    self.pairings.pop(key, None)

    def detach_receiver(self, receiver, channel):
        with self.lock:
            if self.receivers.get(receiver['key']) is receiver and receiver['channel'] is channel:
                receiver.update(active=False, detached=self.clock())
                binding = self.bindings.get(receiver['key'])
                if binding:
                    self.release(binding, 'receiver_disconnected')
                else:
                    self.remove_receiver(receiver['key'], receiver)

    def remove_receiver(self, key, receiver):
        with self.lock:
            if self.receivers.get(key) is receiver:
                self.revoke(receiver, 'game_unavailable')
                self.receivers.pop(key, None)
                receiver['channel'].put({'type': 'closed', 'code': 'game_unavailable',
                                          'message': '游戏接收端已关闭'})

    def sweep(self):
        for key, receiver in list(self.receivers.items()):
            detached = receiver.get('detached', 0)
            if (receiver['expires'] <= self.clock() or not receiver['valid']() or
                    (detached and key not in self.bindings and self.clock()-detached > 120)):
                self.remove_receiver(key, receiver)
        self.pairings = {k: v for k, v in self.pairings.items() if v['expires'] > self.clock()}
        for binding in list(self.bindings.values()):
            if binding['expires'] <= self.clock():
                self.revoke(binding['receiver'])

    def logout(self, auth_key):
        with self.lock:
            for key, receiver in list(self.receivers.items()):
                if receiver['auth_key'] == auth_key:
                    self.remove_receiver(key, receiver)

    def close(self):
        with self.lock:
            for key, receiver in list(self.receivers.items()):
                self.remove_receiver(key, receiver)
            self.stopped = True
