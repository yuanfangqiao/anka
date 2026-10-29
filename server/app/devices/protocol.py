"""Small JSON v1 contract shared by browser, diagnostic tools and ESP controllers."""
import json
import math

ACTIONS = frozenset({'jump', 'reload', 'next_weapon', 'grenade', 'shield',
                     'heal', 'roll', 'interact', 'toggle_crouch'})
INPUT_TIMEOUT = .150
MAX_FRAME = 4096


class DeviceError(ValueError):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.status = code, status


def fail(code, message, status=400):
    raise DeviceError(code, message, status)


def number(value, limit):
    if (isinstance(value, bool) or not isinstance(value, (int, float)) or
            abs(value) > limit or not math.isfinite(value)):
        fail('invalid_message', '输入数值无效或超出范围')
    return value


def decode(raw):
    if len(raw.encode()) > MAX_FRAME:
        fail('invalid_message', '设备消息超过4KiB')
    try:
        value = json.loads(raw, parse_constant=lambda _: fail('invalid_message', '无效数值'))
    except (ValueError, RecursionError) as exc:
        if isinstance(exc, DeviceError):
            raise
        fail('invalid_message', '消息必须是有效JSON对象')
    if not isinstance(value, dict):
        fail('invalid_message', '消息必须是JSON对象')
    return value


def control(value, previous):
    seq = value.get('seq')
    if isinstance(seq, bool) or not isinstance(seq, int) or not 0 < seq < 2**53:
        fail('invalid_message', 'seq必须为正整数')
    if seq <= previous:
        return None
    if value.get('type') == 'action':
        if not isinstance(value.get('action'), str) or value['action'] not in ACTIONS:
            fail('invalid_message', '未知手柄功能')
        return {'type': 'action', 'seq': seq, 'action': value['action']}
    if value.get('type') != 'input':
        fail('invalid_message', '未知输入类型')
    move, look, buttons = (value.get(k) for k in ('move', 'look', 'buttons'))
    if not all(isinstance(x, dict) for x in (move, look, buttons)):
        fail('invalid_message', 'input需要完整move/look/buttons')
    x, y = number(move.get('x'), 1), number(move.get('y'), 1)
    length = math.hypot(x, y)
    if length > 1.0001:
        fail('invalid_message', '移动向量长度不能超过1')
    if length > 1:
        x, y = x / length, y / length
    yaw, pitch = number(look.get('yaw'), 45), number(look.get('pitch'), 45)
    if any(type(buttons.get(k)) is not bool for k in ('fire', 'aim')):
        fail('invalid_message', '按键状态必须为boolean')
    frame = {'type': 'input', 'seq': seq, 'move': {'x': x, 'y': y},
            'look': {'yaw': yaw, 'pitch': pitch},
            'buttons': {k: buttons[k] for k in ('fire', 'aim')},
            'turn': number(value.get('turn', 0), 180)}
    if 'turnTotal' in value:
        frame['turnTotal'] = number(value['turnTotal'], 1_000_000_000)
    if 'pose' in value:
        pose = value['pose']
        if not isinstance(pose, dict) or type(pose.get('id')) is not int or not 1 <= pose['id'] <= 2147483647:
            fail('invalid_message', '无效姿态基准')
        q = pose.get('q')
        if not isinstance(q, list) or len(q) != 4:
            fail('invalid_message', '姿态需要四元数[w,x,y,z]')
        q = [number(v, 1.01) for v in q]
        norm = math.sqrt(sum(v*v for v in q))
        if not .99 <= norm <= 1.01:
            fail('invalid_message', '姿态四元数必须归一化')
        gain = number(pose.get('gain', 1), 3)
        if gain < .25:
            fail('invalid_message', '姿态灵敏度超出范围')
        frame['pose'] = {'id': pose['id'], 'q': [v/norm for v in q], 'gain': gain}
    return frame


def neutral(frame):
    return (frame['type'] == 'input' and not any(frame['move'].values())
            and not any(frame['look'].values()) and not any(frame['buttons'].values()))


def feedback(value):
    kind = value.get('type')
    if kind == 'ack':
        seq = value.get('seq')
        if type(seq) is not int or seq < 1 or value.get('status') not in ('applied', 'submitted', 'rejected'):
            fail('invalid_message', '无效动作结果')
        return {'type': kind, 'seq': seq, 'status': value['status'],
                'reason': str(value.get('reason', ''))[:48]}
    if kind == 'feedback':
        event = value.get('event')
        if event not in ('damage', 'shot', 'reload_complete', 'death', 'win'):
            fail('invalid_message', '未知反馈事件')
        return {'type': kind, 'event': event,
                'strength': number(value.get('strength', .3), 1),
                'durationMs': max(0, number(value.get('durationMs', 40), 200))}
    fail('invalid_message', '接收端不支持这条消息')
