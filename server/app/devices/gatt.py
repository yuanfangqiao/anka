"""Local BLE authority only; input and feedback never transit this module."""
import time
from .protocol import fail


class GattChannel:
    def __init__(self, owner):
        self.owner = owner

    def put(self, frame):
        if frame['type'] == 'closed':
            self.owner.put({**frame, 'type': 'gatt_revoked'})
        elif frame['type'] == 'rearm':
            self.owner.put({'type': 'gatt_rearm'})


class GattBindings:
    def gatt(self, receiver, channel, value):
        """Called under the RLock from the authenticated receiver socket."""
        self.check(receiver)
        kind = value['type']
        if kind == 'gatt_bind':
            key, token = value.get('bindKey'), value.get('token')
            if key is None and token is None:
                binding, secret = self.create_binding(receiver, GattChannel(channel), transport='gatt')
                return self.gatt_authorized(binding, receiver, value, secret)
            if not isinstance(key, str) or not isinstance(token, str):
                fail('invalid_token', '缺少扫码凭证', 403)
            binding, secret = self.join(key, token, GattChannel(channel), transport='gatt', receiver=receiver)
        else:
            binding = self.bindings.get(receiver['key'])
            if not binding or binding.get('transport') != 'gatt':
                fail('invalid_token', '蓝牙设备绑定已失效', 403)
            if kind == 'gatt_resume':
                if value.get('deviceId') != binding['deviceId']:
                    fail('wrong_principal', '蓝牙设备不属于当前玩家', 403)
                binding, secret = self.reconnect(value.get('deviceId'), value.get('token'), GattChannel(channel), transport='gatt')
            else:
                self.check_binding(binding)
                current = binding.get('channel')
                if not isinstance(current, GattChannel) or current.owner is not channel:
                    fail('wrong_principal', '不是当前蓝牙接收端', 403)
                if kind == 'gatt_detach':
                    self.detach(binding, current)
                    return {'type': 'gatt_detached', 'requestId': value.get('requestId')}
                if kind != 'gatt_lease':
                    fail('invalid_message', '未知蓝牙控制消息')
                secret = None
        return self.gatt_authorized(binding, receiver, value, secret)

    def gatt_authorized(self, binding, receiver, value, secret):
        binding['lease_until'] = time.monotonic() + 1.5
        result = {'type': 'gatt_authorized', 'deviceId': binding['deviceId'], 'requestId': value.get('requestId'), 'leaseMs': 1500, 'active': receiver['active']}
        if secret:
            result['resumeToken'] = secret
        return result

    def gatt_lost(self, receiver, channel):
        binding = self.bindings.get(receiver['key'])
        current = binding and binding.get('channel')
        if isinstance(current, GattChannel) and current.owner is channel:
            self.detach(binding, current)

    def gatt_expire(self, binding):
        if (binding and binding.get('transport') == 'gatt' and binding.get('channel')
                and time.monotonic() > binding.get('lease_until', 0)):
            self.detach(binding, binding['channel'])
