"""Browser origin checks and narrowly scoped guest static access."""
from urllib.parse import urlsplit

from fastapi import HTTPException

from .. import auth, deps, settings
from .service import COOKIE, RoomError


def hub():
    service = deps.manager.ctx.get('rooms')
    if service is None:
        raise HTTPException(503, '房间服务尚未启动')
    return service


def public_origin(request):
    configured = settings.ROOM_PUBLIC_URL.rstrip('/')
    if configured:
        return configured
    # Vite proxies must preserve Host; forwarded headers are a deployment concern.
    return str(request.base_url).rstrip('/').replace('ws://', 'http://', 1).replace('wss://', 'https://', 1)


def check_origin(request):
    origin = request.headers.get('origin')
    expected = urlsplit(public_origin(request))
    actual = urlsplit(origin or '')
    if not origin or (actual.scheme, actual.netloc) != (expected.scheme, expected.netloc):
        raise HTTPException(403, '请求来源不受信任')
    if request.headers.get('sec-fetch-site') == 'cross-site':
        raise HTTPException(403, '不允许跨站房间操作')


def member(request):
    username = auth.current_user(request)
    if not username:
        raise HTTPException(401, '请先登录 Anka')
    return username


def access(request, app, rid):
    service = hub()
    room = service.room(app, rid)
    pid, expires = service.actor(room, auth.current_user(request),
                                request.cookies.get(COOKIE))
    return service, room, pid, expires


def guest_asset(request):
    path = request.url.path
    if not path.startswith('/plugins/'):
        return False
    parts = path.split('/', 3)
    if len(parts) != 4:
        return False
    service = deps.manager.ctx.get('rooms')
    return bool(service and service.asset(parts[2], parts[3],
                                         request.cookies.get(COOKIE)))


def http_error(exc: RoomError):
    return HTTPException(exc.status, {'error': exc.code, 'message': str(exc)})
