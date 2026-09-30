"""
FastAPI 应用入口。

- lifespan 内 bootstrap 插件内核（持锁 + to_thread）
- /api/* 业务路由
- 生产形态：托管 web/dist（/assets 静态目录 + SPA 深链回退 index.html）
"""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import deps, settings
from .api import apps, chat, health, plugins
from .logging_conf import setup_logging

log = logging.getLogger('agentos')


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    async with deps.kernel_lock:
        await asyncio.to_thread(
            deps.manager.bootstrap,
            settings.PLUGIN_CONFIG,
            settings.PLUGINS_PACKAGE,
        )
    log.info('AgentOS ready, dist=%s (exists=%s)',
             settings.DIST_DIR, settings.DIST_DIR.is_dir())
    yield


app = FastAPI(title='AgentOS · PWA Agent 样例', lifespan=lifespan)

app.include_router(health.router, prefix='/api')
app.include_router(plugins.router, prefix='/api/plugins')
app.include_router(apps.router, prefix='/api')
app.include_router(chat.router, prefix='/api')

_DIST = settings.DIST_DIR
if (_DIST / 'assets').is_dir():
    app.mount('/assets', StaticFiles(directory=_DIST / 'assets'), name='assets')


@app.get('/{full_path:path}', include_in_schema=False)
async def spa_fallback(full_path: str):
    """SPA 深链回退：已构建文件直接返回，其余回 index.html"""
    if full_path.startswith('api/'):
        raise HTTPException(status_code=404,
                            detail={'error': 'not_found',
                                    'message': f'/api/{full_path[4:]} 不存在'})
    if _DIST.is_dir():
        if full_path:
            target = _DIST / full_path
            if target.is_file():
                return FileResponse(target)
        index = _DIST / 'index.html'
        if index.is_file():
            return FileResponse(index)
    return JSONResponse({
        'detail': '前端未构建：cd web && npm run build；开发态请用 vite dev（localhost:5173）',
    })
