"""Explicit User/Share target resolvers. Device credentials never enter here."""
import re

from fastapi import HTTPException

from .. import auth, deps
from ..rooms.security import check_origin, public_origin
from ..rooms.service import COOKIE, RoomError
from .protocol import DeviceError, fail
from .service import digest


def hub():
    service = deps.manager.ctx.get('devices')
    if service is None:
        raise HTTPException(503, '设备服务尚未启动')
    return service


def target(request, principal, app, runtime, room_id=''):
    if not re.fullmatch(r'[A-Za-z0-9_-]{8,80}', runtime or ''):
        fail('invalid_target', '无效游戏实例')
    service = hub()
    if app not in service.apps:
        fail('game_unavailable', '游戏尚未启用设备接入', 404)
    rooms = deps.manager.ctx.get('rooms')
    if principal == 'user':
        username = auth.current_user(request)
        if not username:
            fail('wrong_principal', '此入口需要Anka用户身份', 401)
        cookie = request.cookies.get(auth.COOKIE_NAME, '')
        expires = (service.clock()+43200 if auth.DEBUG_DISABLE_AUTH
                   else float(cookie.split('.')[1]))
        auth_key = digest('user:'+cookie if cookie else 'dev:'+username)

        def valid_user():
            return auth.DEBUG_DISABLE_AUTH or auth.verify_session(cookie) == username

        valid, actor, name = valid_user, username, username
        if room_id:
            room = rooms.room(app, room_id)
            actor, room_exp = rooms.actor(room, username=username)
            expires = min(expires, room_exp)
            name = room['players'][actor]['name']

            def valid():
                try:
                    live = rooms.room(app, room_id)
                    return valid_user() and live['owner'] == username and actor in live['players']
                except RoomError:
                    return False
    elif principal == 'share':
        token = request.cookies.get(COOKIE)
        visitor = rooms.store.visitor(token, service.clock()) if rooms else None
        if not visitor or visitor['app'] != app or visitor['room'] != room_id:
            fail('wrong_principal', '此入口需要指定房间的Share身份', 401)
        room = rooms.room(app, room_id)
        actor, expires = visitor['player'], visitor['expires']
        if actor not in room['players']:
            fail('binding_revoked', '你已离开这个房间', 403)
        name, auth_key = room['players'][actor]['name'], digest('share:'+token)

        def valid():
            try:
                live = rooms.room(app, room_id)
                record = rooms.store.visitor(token, service.clock())
                return bool(record and record['player'] == actor and actor in live['players'])
            except RoomError:
                return False
    else:
        fail('wrong_principal', '未知授权入口', 404)
    return dict(key=(app, room_id or 'solo', actor), app=app, room=room_id,
                runtime=runtime, name=name, expires=expires, valid=valid, auth_key=auth_key)


def device_origin(request):
    # Native ESP/tools have no Origin. A browser-supplied Origin must be trusted.
    if request.headers.get('origin'):
        check_origin(request)


def http_error(exc):
    return HTTPException(exc.status, {'error': exc.code, 'message': str(exc)})


ERRORS = (DeviceError, RoomError)
