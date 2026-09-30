"""GET /api/health —— 进程与插件计数"""

import asyncio

from fastapi import APIRouter

from .. import deps
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
