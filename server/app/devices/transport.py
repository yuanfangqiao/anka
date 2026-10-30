"""Device and authenticated game receiver sockets; no player socket reuse."""
import asyncio
import time

from fastapi import HTTPException, WebSocketDisconnect

from .channel import Channel
from .protocol import INPUT_TIMEOUT, control, decode, fail, feedback, neutral
from .security import ERRORS, check_origin, device_origin, hub, target


async def sender(ws, channel):
    while True:
        frame = await channel.get()
        await asyncio.wait_for(ws.send_json(frame), .5)
        if frame['type'] == 'closed':
            await ws.close(4403, frame.get('code', 'closed'))
            channel.closed = True
            return


async def error(ws, exc):
    code = getattr(exc, 'code', 'wrong_principal')
    try:
        if ws.application_state.name == 'CONNECTED':
            kind = 'closed' if code in ('binding_revoked', 'game_unavailable') else 'error'
            await ws.send_json({'type': kind, 'code': code,
                                'message': str(exc) if not isinstance(exc, HTTPException) else '身份或来源验证失败'})
        await ws.close(4403, code)
    except (RuntimeError, WebSocketDisconnect):
        pass


async def run(ws, channel, receive):
    tasks = [asyncio.create_task(sender(ws, channel)), asyncio.create_task(receive())]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    finally:
        channel.closed = True
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


class Reader:
    def __init__(self, ws):
        self.ws, self.start, self.count, self.seen = ws, time.monotonic(), 0, time.monotonic()

    async def read(self):
        if time.monotonic()-self.seen > 12:
            fail('heartbeat_timeout', '连接心跳超时', 408)
        try:
            message = await asyncio.wait_for(self.ws.receive(), .05)
        except asyncio.TimeoutError:
            return None
        if message['type'] == 'websocket.disconnect':
            raise WebSocketDisconnect(message.get('code', 1000))
        raw = message.get('text')
        if not isinstance(raw, str):
            fail('invalid_message', '设备协议只接受JSON文本帧')
        self.seen = time.monotonic()
        if self.seen-self.start >= 1:
            self.start, self.count = self.seen, 0
        self.count += 1
        if self.count > 120:
            fail('rate_limited', '设备消息过于频繁', 429)
        return decode(raw)


async def device_socket(ws, reconnect=False):
    channel, binding, service = Channel(), None, None
    try:
        device_origin(ws)
        service = hub()
        service.throttle(('join', ws.client.host if ws.client else 'unknown'), 60)
        token = ws.query_params.get('token', '')
        identity = ws.query_params.get('deviceId' if reconnect else 'bindKey', '')
        if not 16 <= len(token) <= 128 or not 8 <= len(identity) <= 80:
            fail('invalid_token', '设备凭证无效', 403)
        # Only device query credentials are considered, regardless of any cookies.
        binding, secret = (service.reconnect(identity, token, channel) if reconnect
                           else service.join(identity, token, channel))
        await ws.accept()
        await ws.send_json({'type': 'bound', 'deviceId': binding['deviceId'],
                           'playerName': binding['receiver']['name'], 'inputHz': 60,
                           'inputTimeoutMs': 150, 'resumeToken': secret})
        reader = Reader(ws)

        async def receive():
            while not channel.closed:
                with service.lock:
                    service.check_binding(binding)
                    if binding['channel'] is not channel:
                        return
                    if binding['armed'] and time.monotonic()-binding['last_input'] > INPUT_TIMEOUT:
                        service.release(binding, 'input_timeout')
                value = await reader.read()
                if value is None:
                    continue
                if value.get('type') == 'ping':
                    channel.put({'type': 'pong', 'id': value.get('id'), 't': value.get('t')})
                    continue
                if value.get('type') == 'info':
                    continue  # Optional diagnostics never affect authority.
                with service.lock:
                    service.check_binding(binding)
                    # Reconnection can replace the channel while read() awaits.
                    if binding['channel'] is not channel:
                        return
                    frame = control(value, binding['seq'])
                    if frame is None:
                        continue
                    binding['seq'] = frame['seq']
                    if frame['type'] == 'input':
                        binding['last_input'] = time.monotonic()
                        if neutral(frame):
                            binding['armed'] = True
                        if not binding['armed']:
                            continue
                        frame['pressedFire'] = frame['buttons']['fire'] and not binding['fire']
                        binding['fire'] = frame['buttons']['fire']
                    if not binding['armed'] or not binding['receiver']['active']:
                        continue
                    binding['receiver']['channel'].put(frame)
        await run(ws, channel, receive)
    except (WebSocketDisconnect, asyncio.TimeoutError, asyncio.CancelledError):
        pass
    except (*ERRORS, HTTPException, TypeError) as exc:
        await error(ws, exc)
    finally:
        channel.closed = True
        if binding and service:
            service.detach(binding, channel)


async def receiver_socket(ws, principal, app):
    channel, receiver, service = Channel(), None, None
    try:
        check_origin(ws)
        service = hub()
        resolved = target(ws, principal, app, ws.query_params.get('runtime', ''),
                          ws.query_params.get('room', ''))
        receiver = service.add_receiver(resolved, channel)
        await ws.accept()
        await ws.send_json({'type': 'receiver_ready', 'inputTimeoutMs': 150})
        reader = Reader(ws)

        async def receive():
            while not channel.closed:
                with service.lock:
                    service.check(receiver)
                    binding = service.bindings.get(receiver['key'])
                    service.gatt_expire(binding)
                    if binding and binding['armed'] and time.monotonic()-binding['last_input'] > INPUT_TIMEOUT:
                        service.release(binding, 'input_timeout')
                value = await reader.read()
                if value is None:
                    continue
                kind = value.get('type')
                # A device may have joined while receive_text was awaiting data.
                with service.lock:
                    service.check(receiver)
                    binding = service.bindings.get(receiver['key'])
                if kind in ('gatt_bind', 'gatt_resume', 'gatt_lease', 'gatt_detach'):
                    try:
                        with service.lock:
                            channel.put(service.gatt(receiver, channel, value))
                    except ERRORS as exc:
                        channel.put({'type': 'gatt_error', 'requestId': value.get('requestId'),
                                     'code': getattr(exc, 'code', 'invalid_message'), 'message': str(exc)})
                elif kind == 'receiver':
                    if type(value.get('active')) is not bool:
                        fail('invalid_message', '无效游戏前台状态')
                    receiver.update(active=value['active'], seen=time.monotonic())
                    if not receiver['active'] and binding:
                        service.release(binding, 'receiver_inactive')
                elif kind == 'ping':
                    channel.put({'type': 'pong', 't': value.get('t')})
                else:
                    frame = feedback(value)
                    if binding and binding['channel']:
                        binding['channel'].put(frame)
        await run(ws, channel, receive)
    except (WebSocketDisconnect, asyncio.TimeoutError, asyncio.CancelledError):
        pass
    except (*ERRORS, HTTPException, TypeError) as exc:
        await error(ws, exc)
    finally:
        channel.closed = True
        if receiver and service:
            with service.lock:
                service.gatt_lost(receiver, channel)
            service.detach_receiver(receiver, channel)
