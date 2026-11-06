"""Event-loop-owned browser peers, callable from the synchronous Agent worker."""
import asyncio
import base64
import concurrent.futures
import json
import secrets
from dataclasses import dataclass

MAX_FRAME = 64 * 1024
MAX_IMAGE = 1024 * 1024
COMMAND_TIMEOUT = 24


class WebUseError(Exception):
    pass


@dataclass
class Observation:
    text: str
    image: str

    def __str__(self):
        return self.text


class Peer:
    def __init__(self, user, socket):
        self.id = secrets.token_urlsafe(24)
        self.user = user
        self.socket = socket
        self.loop = asyncio.get_running_loop()
        self.lease = None
        self.pending = None
        self.closed = False

    def reserve(self):
        if self.closed or self.lease is not None:
            raise WebUseError('这个窗口已有网页操作任务，或已经断开')
        self.lease = secrets.token_urlsafe(18)
        return self.lease

    def release(self, lease):
        if self.lease == lease:
            self.lease = None

    def abort(self):
        self.closed = True
        if self.pending and not self.pending['future'].done():
            self.pending['future'].set_exception(WebUseError('浏览器连接已断开'))

    def receive(self, message):
        pending = self.pending
        if not pending or message.get('id') != pending['id'] or message.get('type') != 'result':
            return
        future = pending['future']
        if future.done():
            return
        if message.get('ok') is True and isinstance(message.get('data'), dict):
            future.set_result(message['data'])
        else:
            future.set_exception(WebUseError(str(message.get('error') or '浏览器执行失败')[:400]))

    def image_slot(self, request_id):
        p = self.pending
        if self.closed or not p or p['id'] != request_id or not p['wants_image'] or p['future'].done():
            raise WebUseError('截图请求已结束')
        if p['image'] is not None:
            raise WebUseError('截图已经上传')
        return p

    async def request(self, lease, command, args):
        if self.closed or self.lease != lease or self.pending is not None:
            raise WebUseError('浏览器连接已失效或正在执行动作')
        request_id = secrets.token_urlsafe(18)
        future = self.loop.create_future()
        pending = {'id': request_id, 'future': future, 'image': None,
                   'wants_image': command == 'observe' and args.get('image') is True}
        self.pending = pending
        try:
            await asyncio.wait_for(self.socket.send_json({
                'type': 'command', 'id': request_id, 'lease': lease, 'command': command, 'args': args,
            }), 4)
            result = await asyncio.wait_for(future, COMMAND_TIMEOUT)
            text = json.dumps(result, ensure_ascii=False, allow_nan=False)
            if pending['image'] is not None and isinstance(result.get('image'), dict):
                mime, data = pending['image']
                encoded = base64.b64encode(data).decode('ascii')
                return Observation(text, f'data:{mime};base64,{encoded}')
            return text
        except (TimeoutError, asyncio.CancelledError):
            if not self.closed:
                try:
                    await asyncio.wait_for(self.socket.send_json({'type': 'cancel', 'id': request_id}), 1)
                except Exception:
                    self.abort()
            raise
        finally:
            if not future.done():
                future.cancel()
            elif not future.cancelled():
                future.exception()
            self.pending = None

    def call(self, lease, cancel, command, args):
        if cancel.is_set() or self.closed:
            raise WebUseError('网页操作已停止')
        coroutine = self.request(lease, command, args)
        try:
            future = asyncio.run_coroutine_threadsafe(coroutine, self.loop)
        except RuntimeError:
            coroutine.close()
            raise WebUseError('浏览器连接已关闭') from None
        while True:
            if cancel.is_set():
                future.cancel()
                raise WebUseError('网页操作已停止')
            try:
                return future.result(.1)
            except concurrent.futures.TimeoutError:
                if future.done():
                    raise WebUseError('浏览器响应超时；请重新观察后再操作') from None
