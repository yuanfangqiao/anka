"""
App 插件接口：GET /api/apps（前端宿主加载清单）+
通用数据通道 GET /api/apps/{id}/state、POST /api/apps/{id}/call。
"""

import asyncio
import logging

from fastapi import APIRouter, HTTPException

from .. import deps
from ..schemas import AppCallRequest, AppInfo

log = logging.getLogger('agentos.api.apps')
router = APIRouter(tags=['apps'])


@router.get('/apps', response_model=list[AppInfo])
async def list_apps() -> list[AppInfo]:
    return await asyncio.to_thread(deps.manager.apps)


def _service_or_404(app_id: str):
    svc = deps.manager.app_service(app_id)
    if svc is None:
        raise HTTPException(
            status_code=404,
            detail={'error': 'app_not_found',
                    'message': f'应用 "{app_id}" 未安装或无后端服务'})
    return svc


@router.get('/apps/{app_id}/state')
async def app_state(app_id: str):
    svc = await asyncio.to_thread(_service_or_404, app_id)
    snapshot = getattr(svc, 'snapshot', None)
    if not callable(snapshot):
        return {}
    return await asyncio.to_thread(snapshot)


@router.post('/apps/{app_id}/call')
async def app_call(app_id: str, req: AppCallRequest):
    if req.method.startswith('_'):
        raise HTTPException(
            status_code=400,
            detail={'error': 'method_forbidden',
                    'message': '不允许调用下划线开头的方法'})
    svc = await asyncio.to_thread(_service_or_404, app_id)
    fn = getattr(svc, req.method, None)
    if not callable(fn):
        raise HTTPException(
            status_code=404,
            detail={'error': 'method_not_found',
                    'message': f'服务 "{app_id}" 没有方法 "{req.method}"'})
    try:
        result = await asyncio.to_thread(fn, **req.args)
    except TypeError as e:
        raise HTTPException(
            status_code=400,
            detail={'error': 'bad_args', 'message': str(e)})
    return {'ok': True, 'result': result}
