"""Standalone guest entry avoids bootstrapping the account-only Anka shell."""
import json
import secrets
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from .security import access, http_error, hub, member
from .service import COOKIE, RoomError

router = APIRouter()
HEADERS = {'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
           'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN'}


@router.get('/join/{app}/{rid}', include_in_schema=False)
async def join(app: str, rid: str):
    try:
        hub().room(app, rid)
        nonce = secrets.token_urlsafe(16)
        html = Path(__file__).with_name('join.html').read_text()
        config = json.dumps({'app': app, 'room': rid}).replace('<', '\\u003c')
        html = html.replace('__CONFIG__', config).replace('__NONCE__', nonce)
        return HTMLResponse(html, headers={**HEADERS, 'Content-Security-Policy':
            f"default-src 'none'; style-src 'nonce-{nonce}'; script-src 'nonce-{nonce}'; "
            "connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"})
    except RoomError as exc:
        return HTMLResponse('<!doctype html><meta charset="utf-8"><title>邀请已失效</title>'
                            '<p>房间不存在或已关闭，请联系房主重新邀请。</p>',
                            status_code=exc.status, headers=HEADERS)


@router.get('/play/{app}', include_in_schema=False)
@router.get('/play/{app}/{rid}', include_in_schema=False)
async def play(app: str, request: Request, rid: str = ''):
    try:
        service = hub()
        spec = service.definition(app)
        if rid:
            access(request, app, rid)
        else:
            visitor = service.store.visitor(request.cookies.get(COOKIE), service.clock())
            if visitor and visitor['app'] == app:
                service.room(app, visitor['room'])
                return RedirectResponse(f'/play/{app}/{visitor["room"]}')
            member(request)
        root = Path(spec['root']).resolve()
        target = (root / spec['entry']).resolve()
        target.relative_to(root)
        if not target.is_file():
            from fastapi import HTTPException
            raise HTTPException(409, '游戏尚未构建，请在插件管理中构建并安装')
        html = target.read_text()
        prefix = f'/plugins/{app}/{Path(spec["entry"]).parent.as_posix()}/'
        html = html.replace('<head>', f'<head><base href="{prefix}">', 1)
        return HTMLResponse(html, headers=HEADERS)
    except RoomError as exc:
        raise http_error(exc)
