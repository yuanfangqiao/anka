"""Thin HTTP adapters. All lobby/capability business is in the rooms plugin."""
from fastapi import APIRouter, Request, Response, WebSocket
from pydantic import BaseModel, Field
from ..auth import client_ip

from . import lobby
from .security import access, check_origin, http_error, hub, member, public_origin
from .service import COOKIE, RoomError

router = APIRouter(prefix='/api/rooms', tags=['rooms'])


class CreateBody(BaseModel):
    name: str = Field(default='', max_length=24)
    character: str = 'male'
    map: str = 'desert'


class RedeemBody(BaseModel):
    token: str = Field(min_length=32, max_length=128)
    name: str = Field(default='好友', max_length=24)


class CommandBody(BaseModel):
    action: str = Field(max_length=24)
    args: dict = Field(default_factory=dict)


def invitation(request, app, rid, invite):
    return {'url': f'{public_origin(request)}/join/{app}/{rid}#invite={invite["token"]}',
            'expires': invite['expires']}


@router.get('/{app}/capabilities')
async def capabilities(app: str, request: Request):
    member(request)
    try:
        spec = hub().definition(app)
        return {key: spec[key] for key in ('protocol', 'build', 'maps', 'characters')}
    except RoomError as exc:
        raise http_error(exc)


@router.post('/{app}')
async def create(app: str, body: CreateBody, request: Request):
    check_origin(request)
    username = member(request)
    try:
        hub().throttle(('create', client_ip(request)), 10)
        room, invite = hub().create(app, username, body.name, body.character, body.map)
        return {'room': room, 'invite': invitation(request, app, room['id'], invite)}
    except RoomError as exc:
        raise http_error(exc)


@router.post('/{app}/{rid}/redeem')
async def redeem(app: str, rid: str, body: RedeemBody, request: Request, response: Response):
    check_origin(request)
    try:
        hub().throttle(('redeem', client_ip(request)))
        room, token, expires = hub().redeem(app, rid, body.token, body.name,
                                          request.cookies.get(COOKIE))
        response.set_cookie(COOKIE, token, max_age=max(1, int(expires - hub().clock())),
                            httponly=True, secure=public_origin(request).startswith('https://'),
                            samesite='lax', path='/')
        response.headers['Cache-Control'] = 'no-store'
        return {'room': room, 'session_expires': expires,
                'play_url': f'/play/{app}/{rid}'}
    except RoomError as exc:
        raise http_error(exc)


@router.get('/{app}/{rid}')
async def state(app: str, rid: str, request: Request, response: Response):
    try:
        service, room, pid, expires = access(request, app, rid)
        response.headers['Cache-Control'] = 'no-store'
        return {'room': service.view(room, pid), 'session_expires': expires}
    except RoomError as exc:
        raise http_error(exc)


@router.post('/{app}/{rid}/invite')
async def invite(app: str, rid: str, request: Request):
    check_origin(request)
    try:
        service, room, pid, _ = access(request, app, rid)
        return invitation(request, app, rid, service.invite(room, pid))
    except RoomError as exc:
        raise http_error(exc)


@router.post('/{app}/{rid}/command')
async def command(app: str, rid: str, body: CommandBody, request: Request):
    check_origin(request)
    try:
        service, room, pid, _ = access(request, app, rid)
        lobby.command(service, room, pid, body.action, body.args)
        return {'room': service.view(room, pid)}
    except RoomError as exc:
        raise http_error(exc)


@router.websocket('/{app}/{rid}/ws')
async def socket(ws: WebSocket, app: str, rid: str):
    service = hub()
    await service.bus.socket(ws, app, rid)
