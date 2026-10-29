"""Thin User/Share management adapters and credential-only device WS endpoints."""
from urllib.parse import urlencode

from fastapi import APIRouter, Request, Response, WebSocket
from pydantic import BaseModel, Field

from .security import ERRORS, check_origin, http_error, hub, public_origin, target
from .transport import device_socket, receiver_socket

router = APIRouter(tags=['devices'])


class TargetBody(BaseModel):
    runtime: str = Field(min_length=8, max_length=80)
    room: str = Field(default='', max_length=80)


@router.post('/api/devices/{principal}/{app}/pairings')
async def pair(principal: str, app: str, body: TargetBody, request: Request, response: Response):
    check_origin(request)
    try:
        service = hub()
        resolved = target(request, principal, app, body.runtime, body.room)
        service.throttle(('pair', resolved['auth_key']))
        receiver = service.receiver(resolved, body.runtime)
        key, token, expires = service.pair(receiver)
        query = urlencode({'bindKey': key, 'token': token})
        url = f'{public_origin(request)}/v1/device/join?{query}'
        response.headers['Cache-Control'] = 'no-store'
        return {'url': url, 'wsUrl': url.replace('https:', 'wss:', 1).replace('http:', 'ws:', 1),
                'expiresAt': expires}
    except ERRORS as exc:
        raise http_error(exc)


@router.post('/api/devices/{principal}/{app}/unbind')
async def unbind(principal: str, app: str, body: TargetBody, request: Request):
    check_origin(request)
    try:
        resolved = target(request, principal, app, body.runtime, body.room)
        service = hub()
        service.revoke(service.receiver(resolved, body.runtime))
        return {'ok': True}
    except ERRORS as exc:
        raise http_error(exc)


@router.websocket('/api/devices/{principal}/{app}/receiver/ws')
async def receiver(ws: WebSocket, principal: str, app: str):
    await receiver_socket(ws, principal, app)


@router.websocket('/v1/device/join')
async def join(ws: WebSocket):
    await device_socket(ws)


@router.websocket('/v1/device/reconnect')
async def reconnect(ws: WebSocket):
    await device_socket(ws, reconnect=True)
