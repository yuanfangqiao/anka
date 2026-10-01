"""GET /api/health —— 进程与插件计数；GET /api/config —— 壳层配置下发"""

import asyncio

from fastapi import APIRouter

from .. import deps, settings
from ..schemas import Health

router = APIRouter(tags=['health'])


@router.get('/health', response_model=Health)
async def health() -> Health:
    infos = await asyncio.to_thread(deps.manager.list_plugins)
    return Health(
        status='ok',
        plugins_total=len(infos),
        plugins_active=sum(1 for i in infos if i.state == 'ACTIVE'),
    )


@router.get('/config')
async def config() -> dict:
    """壳层配置（内核所有，前端只读）"""
    return settings.SHELL_CONFIG
