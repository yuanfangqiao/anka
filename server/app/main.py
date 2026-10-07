"""
FastAPI 应用入口。

- lifespan 内 bootstrap 插件内核（持锁 + to_thread）
- /api/* 业务路由
- 生产形态：托管 web/dist（/assets 静态目录 + SPA 深链回退 index.html）
"""

import asyncio
import logging
import re
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import deps, settings
from .api import (apps, chat, health, plugins, runs, sessions, settings_api,
                 sync_api)
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
app.include_router(runs.router, prefix='/api')
app.include_router(sessions.router, prefix='/api')
app.include_router(settings_api.router, prefix='/api')
app.include_router(sync_api.router, prefix='/api')

_DIST = settings.DIST_DIR
if (_DIST / 'assets').is_dir():
    app.mount('/assets', StaticFiles(directory=_DIST / 'assets'), name='assets')

# M9：插件前端「安装时编译」产物（.plugin-dist/<id>/index.js）
settings.PLUGIN_DIST_DIR.mkdir(parents=True, exist_ok=True)
app.mount('/plugin-dist', StaticFiles(directory=settings.PLUGIN_DIST_DIR),
          name='plugin-dist')

# M11：插件目录静态伺服（dev 由 vite 中间件承担，prod 走这里；
# 与 dev URL 契约一致，page 类静态页应用的入口即 /plugins/<id>/index.html）

@app.get('/plugins/{plugin_id}/{page_path:path}', include_in_schema=False)
async def serve_plugin_html(plugin_id: str, page_path: str):
    """page 类插件 HTML 伺服：改写绝对路径，适配构建时 base="/" 的产物。

    场景：第三方打包好的静态页（如 excalidraw）构建时默认 base="/"，
    其 index.html 引用 /assets/xxx.js。挂上 /plugins/<id>/ 后浏览器
    从站点根 /assets 找 → 404（且会拿到主应用的资源）。
    修复：伺服 .html 时把 src="/X" href="/X" 改写为 src="/plugins/<id>/<dir>/X"。
    其他资源（.js/.css/.png/...）由下面 mount('/plugins') 正常伺服。
    """
    if not page_path.endswith('.html'):
        # 非 HTML 走 StaticFiles mount
        target = settings.APP_PLUGINS_DIR / plugin_id / page_path
        if target.is_file():
            return FileResponse(target)
        raise HTTPException(status_code=404, detail=f'{plugin_id}/{page_path}')

    target = settings.APP_PLUGINS_DIR / plugin_id / page_path
    if not target.is_file():
        raise HTTPException(status_code=404, detail=f'{plugin_id}/{page_path}')

    # 挂载前缀：HTML 所在目录的 URL 路径（末尾带 /）
    url_prefix = f'/plugins/{plugin_id}/{page_path.rsplit("/", 1)[0] + "/" if "/" in page_path else ""}'
    html = target.read_text(encoding='utf-8')
    # 注入 <base>：处理相对路径 + 处理所有以 / 开头的资源
    base_tag = f'<base href="{url_prefix}">'
    if '<base' not in html:
        html = re.sub(r'(<head[^>]*>)', r'\1' + base_tag, html, count=1)
    # 把 src="/X" href="/X" 改写为 src="{prefix}X" —— 跳过 /plugins/、/api/、http(s)
    def _rewrite(m):
        attr, quote, path = m.group(1), m.group(2), m.group(3)
        if path.startswith(('//', '/plugins/', '/api/')):
            return m.group(0)
        return f'{attr}={quote}{url_prefix}{path.lstrip("/")}{quote}'
    html = re.sub(r'(src|href)=(["\'])(/[^"\']*)\2', _rewrite, html)
    return HTMLResponse(html)


app.mount('/plugins', StaticFiles(directory=settings.APP_PLUGINS_DIR),
          name='plugins')


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
