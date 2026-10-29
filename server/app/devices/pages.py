"""Public controller resources, without the account shell or credential caching."""
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from .. import settings

router = APIRouter()
ROOT = settings.WEB_DIR / 'controller'
HEADERS = {'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
           'X-Content-Type-Options': 'nosniff',
           'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"}


@router.get('/v1/device/join', include_in_schema=False)
@router.get('/controller', include_in_schema=False)
async def controller():
    return FileResponse(ROOT / 'index.html', headers=HEADERS)


@router.get('/controller/assets/{name}', include_in_schema=False)
async def asset(name: str):
    path = (ROOT / name).resolve()
    if path.parent != ROOT.resolve() or path.suffix not in ('.js', '.css', '.svg') or not path.is_file():
        raise HTTPException(404)
    return FileResponse(path, headers=HEADERS)
