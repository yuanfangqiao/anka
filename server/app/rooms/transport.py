"""Authenticated bounded WebSocket transport; room state is server-owned."""
import asyncio
import json
import time

from fastapi import WebSocketDisconnect

from .lobby import reset, tick
from .security import access, check_origin
from .service import RoomError, fail


class Channel:
    def __init__(self):
        self.loop = asyncio.get_running_loop()
        self.queue = asyncio.Queue(maxsize=64)
        self.closed = False

    def put(self, payload):
        if self.closed or self.loop.is_closed():
            return
        def deliver():
            if self.closed:
                return
            if self.queue.full():
                self.closed = True
                return
            self.queue.put_nowait(payload)
        try:
            self.loop.call_soon_threadsafe(deliver)
        except RuntimeError:
            self.closed = True


class RoomBus:
    def __init__(self, service):
        self.service, self.channels = service, {}
        service.notify = self.publish

    def publish(self, room):
        for pid, channel in list(self.channels.get(room['id'], {}).items()):
            if pid not in room['players'] or room['phase'] == 'closed':
                channel.put({'type': 'closed', 'message': room['notice'] or '你已离开房间'})
            else:
                channel.put({'type': 'room', 'room': self.service.view(room, pid)})

    def relay(self, room, pid, message):
        if room['phase'] != 'playing' or message.get('round') != room['round']:
            return
        payload = message.get('payload')
        if not isinstance(payload, dict):
            fail('invalid_payload', '无效游戏消息')
        kind = payload.get('type')
        spec = self.service.definition(room['app'])
        allowed = spec['host_events'] if pid == room['host'] else spec['guest_events']
        if kind not in allowed:
            fail('event_forbidden', '你不能发送这个游戏事件', 403)
        # Identity comes from the socket; JSON cannot impersonate another player.
        for other, channel in list(self.channels.get(room['id'], {}).items()):
            if other != pid:
                channel.put({'type': 'game', 'from': pid, 'round': room['round'],
                             'payload': payload})

    async def socket(self, ws, app, rid):
        channel, room, pid = None, None, None
        try:
            check_origin(ws)
            service, room, pid, expires = access(ws, app, rid)
            await ws.accept()
            hello = await asyncio.wait_for(ws.receive_json(), 10)
            if not isinstance(hello, dict) or hello.get('type') != 'hello' or (
                    hello.get('build') != room['build'] or
                    hello.get('protocol') != room['protocol']):
                await ws.close(4409, '游戏版本不同，请刷新后重新加入')
                return
            peers = self.channels.setdefault(rid, {})
            if pid in peers:
                await ws.close(4409, '这个玩家已在另一页面连接')
                return
            channel = Channel()
            peers[pid] = channel
            with service.lock:
                if room['phase'] in ('loading', 'countdown', 'playing', 'reconnecting'):
                    if hello.get('round') != room['round']:
                        reset(room, '玩家刷新了页面，请重新准备')
                room['disconnected'].pop(pid, None)
                room['players'][pid]['online'] = True
                if room['phase'] == 'reconnecting' and all(
                        p['online'] for p in room['players'].values()):
                    if room['resume_phase'] == 'playing':
                        room['paused_total'] += service.clock() - room.pop('pause_started', service.clock())
                    room['phase'] = room['resume_phase']
                service.changed(room)
            sender = asyncio.create_task(self._send(ws, channel))
            try:
                await self._receive(ws, service, room, pid, expires, channel)
            finally:
                sender.cancel()
                try:
                    await asyncio.gather(sender, return_exceptions=True)
                except asyncio.CancelledError:
                    pass
        except (WebSocketDisconnect, asyncio.TimeoutError, asyncio.CancelledError):
            pass
        except (RoomError, ValueError, TypeError, AttributeError, RecursionError, KeyError) as exc:
            try:
                await ws.close(4403, str(exc)[:100])
            except RuntimeError:
                pass
        except Exception as exc:
            # HTTP origin/auth errors may occur before accept.
            from fastapi import HTTPException
            if not isinstance(exc, HTTPException):
                raise
            await ws.close(4403, '房间鉴权失败')
        finally:
            if channel:
                channel.closed = True
                peers = self.channels.get(rid, {})
                if peers.get(pid) is channel:
                    peers.pop(pid, None)
                    if not peers:
                        self.channels.pop(rid, None)
                    with self.service.lock:
                        if pid in room['players'] and room['phase'] != 'closed':
                            room['players'][pid].update(online=False, ready=False)
                            room['disconnected'][pid] = self.service.clock()
                            if room['phase'] in ('playing', 'countdown', 'loading'):
                                room['pause_started'] = self.service.clock()
                                room['resume_phase'], room['phase'] = room['phase'], 'reconnecting'
                            self.service.changed(room)
                    asyncio.create_task(self._expire(room, pid))

    async def _send(self, ws, channel):
        while not channel.closed:
            payload = await channel.queue.get()
            await asyncio.wait_for(ws.send_json(payload), 3)
            if payload['type'] == 'closed':
                await ws.close(4403, '房间权限已撤销')
                channel.closed = True

    async def _receive(self, ws, service, room, pid, expires, channel):
        window, count, last_seen = time.monotonic(), 0, time.monotonic()
        while not channel.closed:
            with service.lock:
                tick(service, room)
                expiry = room['expires'] if pid == room['host'] else expires
                if (service.clock() >= expiry or room['phase'] == 'closed' or
                        pid not in room['players'] or room['app'] not in service.definitions):
                    await ws.close(4403, '房间会话已到期或撤销')
                    return
            if time.monotonic() - last_seen > 20:
                await ws.close(4408, '连接心跳超时')
                return
            try:
                raw = await asyncio.wait_for(ws.receive_text(), 1)
            except asyncio.TimeoutError:
                continue
            last_seen = time.monotonic()
            if len(raw.encode()) > 32 * 1024:
                fail('message_too_large', '消息过大')
            if time.monotonic() - window >= 1:
                window, count = time.monotonic(), 0
            count += 1
            if count > 90:
                fail('rate_limited', '游戏消息过于频繁', 429)
            message = json.loads(raw, parse_constant=lambda _: fail('invalid_number', '数值无效'))
            if not isinstance(message, dict):
                fail('invalid_message', '无效消息')
            if message.get('type') == 'ping':
                channel.put({'type': 'pong', 'sent': message.get('sent'),
                             'server_time': service.clock()})
            elif message.get('type') == 'game':
                self.relay(room, pid, message)
            else:
                fail('invalid_message', '不支持的连接消息')
        await ws.close(4408, '连接已关闭或接收过慢')

    async def _expire(self, room, pid):
        await asyncio.sleep(30)
        with self.service.lock:
            if room['phase'] != 'closed' and pid in room['disconnected']:
                tick(self.service, room)
