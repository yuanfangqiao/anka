"""GET /api/health —— 进程与插件计数；GET /api/config —— 壳层配置下发"""

import asyncio
import json
import subprocess
import time

from fastapi import APIRouter

from .. import deps, settings
from ..schemas import Health

router = APIRouter(tags=['health'])


def _read_api_build() -> str:
    """M17.10：后端自身构建号。git sha 优先，非 git 环境回退 'dev'。"""
    try:
        return subprocess.check_output(
            ['git', 'rev-parse', '--short', 'HEAD'],
            cwd=settings.PROJECT_ROOT, stderr=subprocess.DEVNULL,
        ).decode().strip()
    except Exception:
        return 'dev'


# M17.10：进程级常量，每次部署/重启重新计算
API_BUILD = _read_api_build()

# M17.10：front_build 读 dist/version.json（构建时由 vite 写入）。
# 30s 缓存避免每次 health 读盘；版本感知最长延迟 30s，可接受。
_front_cache: tuple[float, str | None] = (0.0, None)


def get_front_build() -> str | None:
    """当前正在伺服的前端构建号；dev 模式无 dist 时返回 None。"""
    global _front_cache
    now = time.monotonic()
    if now - _front_cache[0] < 30:
        return _front_cache[1]
    value: str | None = None
    try:
        data = json.loads(
            (settings.DIST_DIR / 'version.json').read_text(encoding='utf-8'))
        value = data.get('front_build')
    except Exception:
        value = None
    _front_cache = (now, value)
    return value


@router.get('/health', response_model=Health)
async def health() -> Health:
    infos = await asyncio.to_thread(deps.manager.list_plugins)
    return Health(
        status='ok',
        plugins_total=len(infos),
        plugins_active=sum(1 for i in infos if i.state == 'ACTIVE'),
        front_build=get_front_build(),
        api_build=API_BUILD,
    )


@router.get('/config')
async def config() -> dict:
    """壳层配置（内核所有，前端只读）"""
    return settings.SHELL_CONFIG
