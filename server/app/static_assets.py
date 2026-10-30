"""Negotiated static compression. Authorization remains in the existing routes."""
import mimetypes
import re
from pathlib import Path

from starlette.middleware.gzip import GZipMiddleware
from starlette.requests import Request
from starlette.responses import FileResponse, Response
from starlette.staticfiles import StaticFiles

COMPRESSIBLE = {'.html', '.js', '.mjs', '.css', '.json', '.svg', '.glb', '.gltf', '.wasm'}
HASHED = re.compile(r'/assets/[^/]+-[\w-]{8}\.[\w]+$')


def encoding_quality(header, encoding):
    values = {}
    for part in header.lower().split(','):
        name, *params = part.strip().split(';')
        if not name:
            continue
        quality = next((p.strip()[2:] for p in params if p.strip().startswith('q=')), '1')
        try:
            q = float(quality)
            values[name] = q if 0 <= q <= 1 else 0
        except ValueError:
            values[name] = 0
    if encoding in values:
        return values[encoding]
    if encoding == 'identity':
        return 0 if values.get('*') == 0 else 1
    return values.get('*', 0)


def static_file(file, request, *, cache_control=None):
    original = Path(file)
    stat = original.stat()
    accept = request.headers.get('accept-encoding', '')
    encoding = None
    selected = original
    if original.suffix in COMPRESSIBLE and 'range' not in request.headers:
        choices = sorted(('br', 'gzip'), key=lambda e: -encoding_quality(accept, e))
        for choice in choices:
            if encoding_quality(accept, choice) <= 0:
                continue
            candidate = Path(str(original) + ('.br' if choice == 'br' else '.gz'))
            if candidate.is_file() and candidate.stat().st_mtime_ns >= stat.st_mtime_ns:
                selected, encoding = candidate, choice
                break
    if not encoding and encoding_quality(accept, 'identity') == 0:
        # The dynamic middleware may still provide an accepted gzip representation.
        if not (encoding_quality(accept, 'gzip') > 0 and original.suffix in COMPRESSIBLE
                and 'range' not in request.headers):
            return Response(status_code=406, headers={'Vary': 'Accept-Encoding'})
    immutable = bool(HASHED.search(original.as_posix()))
    headers = {'Vary': 'Accept-Encoding', 'Cache-Control': cache_control or (
        'private, max-age=31536000, immutable' if immutable else 'no-cache')}
    if encoding:
        headers['Content-Encoding'] = encoding
    content_type = {'.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
                    '.wasm': 'application/wasm'}.get(original.suffix)
    content_type = content_type or mimetypes.guess_type(original.name)[0] or 'application/octet-stream'
    response = FileResponse(selected, media_type=content_type, headers=headers,
                            stat_result=selected.stat())
    etag = response.headers.get('etag')
    if request.method in ('GET', 'HEAD') and 'range' not in request.headers:
        matches = request.headers.get('if-none-match', '').split(',')
        if etag and any(v.strip().removeprefix('W/') in (etag, '*') for v in matches):
            return Response(status_code=304, headers={k: v for k, v in response.headers.items()
                            if k in ('etag', 'vary', 'cache-control', 'content-encoding')})
    return response


class CompressedStaticFiles(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if isinstance(response, FileResponse) and response.status_code == 200:
            return static_file(response.path, Request(scope))
        return response


class StaticCompressionMiddleware:
    """Compress static/HTML responses; keep APIs, SSE and sockets untouched."""
    def __init__(self, app):
        self.app = app
        self.compressed = GZipMiddleware(app, minimum_size=1024, compresslevel=6)

    async def __call__(self, scope, receive, send):
        request = Request(scope) if scope['type'] == 'http' else None
        if (request is None or request.url.path.startswith('/api/')
                or request.method not in ('GET', 'HEAD')
                or encoding_quality(request.headers.get('accept-encoding', ''), 'gzip') <= 0):
            return await self.app(scope, receive, send)
        return await self.compressed(scope, receive, send)
