"""Transport only: authenticated live browser and its one-shot image upload."""
import json
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect

from .. import auth, deps
from ..web_use.bridge import MAX_FRAME, MAX_IMAGE, WebUseError

router = APIRouter(prefix='/web-use', tags=['web-use'])


def check_origin(request):
    origin = request.headers.get('origin', '')
    # Compare with the same public authority used by the existing API proxy.
    actual = urlsplit(origin)
    expected = urlsplit(str(request.base_url))
    scheme = {'ws': 'http', 'wss': 'https'}.get(expected.scheme, expected.scheme)
    if (actual.scheme, actual.netloc) != (scheme, expected.netloc) or (
        request.headers.get('sec-fetch-site') == 'cross-site'
    ):
        raise HTTPException(403, '网页操作只允许同源请求')


def service():
    result = deps.manager.ctx.get('web-use')
    if result is None:
        raise HTTPException(503, '网页操作服务未启用')
    return result


@router.websocket('/ws')
async def browser(socket: WebSocket):
    try:
        check_origin(socket)
        user = auth.current_user(socket)
        if not user:
            await socket.close(4401)
            return
        broker = service()
        peer = broker.connect(user, socket)
    except (HTTPException, WebUseError, ValueError):
        await socket.close(4403)
        return

    try:
        await socket.accept()
        await socket.send_json({'type': 'ready', 'clientId': peer.id})
        while not peer.closed:
            event = await socket.receive()
            if event['type'] == 'websocket.disconnect':
                break
            raw = event.get('text')
            if not isinstance(raw, str) or len(raw.encode()) > MAX_FRAME or auth.current_user(socket) != user:
                await socket.close(4403)
                break
            try:
                data = json.loads(raw, parse_constant=_invalid_constant)
            except ValueError:
                await socket.close(4400)
                break
            if isinstance(data, dict):
                if data.get('type') == 'ping':
                    continue
                peer.receive(data)
    except WebSocketDisconnect:
        pass
    finally:
        broker.disconnect(peer)


def _invalid_constant(value):
    raise ValueError(f'Invalid JSON constant: {value}')


@router.post('/image/{request_id}', status_code=204)
async def image(request_id: str, request: Request):
    check_origin(request)
    mime = request.headers.get('content-type')
    if mime not in ('image/jpeg', 'image/png'):
        raise HTTPException(415, '只支持 JPEG / PNG')
    try:
        peer = service().get_peer(auth.current_user(request), request.headers.get('x-anka-web-client'))
        slot = peer.image_slot(request_id)
        data = bytearray()
        async for chunk in request.stream():
            if len(data) + len(chunk) > MAX_IMAGE:
                raise HTTPException(413, '截图超过 1 MB')
            data.extend(chunk)
        prefix = b'\xff\xd8\xff' if mime == 'image/jpeg' else b'\x89PNG\r\n\x1a\n'
        if not data.startswith(prefix):
            raise HTTPException(415, '截图格式无效')
        if peer.image_slot(request_id) is not slot:
            raise WebUseError('截图请求已结束')
        slot['image'] = (mime, bytes(data))
    except WebUseError as exc:
        raise HTTPException(409, str(exc)) from exc
