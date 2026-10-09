"""GET/POST /api/settings —— TokenHub 模型服务配置（M13）。

凭据 seam：
- GET 只返回脱敏视图（sk-tp-****），绝不回传完整 Key
- POST 只写不回读（api_key 落 credentials.json、default_model 落 settings.json）
- adapter 每次请求解析 Key，轮换后下一请求即时生效
"""

import asyncio
import logging

from fastapi import APIRouter, HTTPException

from .. import settings
from ..plugins.llm_tokenhub import TokenHubAdapter
from ..schemas import ModelInfo, SettingsPayload, SettingsView
from ..shell_events import broadcast_shell_event

log = logging.getLogger('agentos.api.settings')
router = APIRouter(tags=['settings'])

_MODEL_IDS = {m['id'] for m in settings.TOKENHUB_MODELS}


@router.get('/settings', response_model=SettingsView)
async def get_settings() -> SettingsView:
    has_key = settings.get_api_key() is not None
    # M17.12：首页偏好（未设置 → None）
    home_app = settings.load_user_settings().get('home_app') or None
    return SettingsView(
        models=[ModelInfo(**m) for m in settings.TOKENHUB_MODELS],
        default_model=settings.get_default_model(),
        base_url=settings.TOKENHUB_BASE_URL,
        has_key=has_key,
        api_key_masked=settings.masked_api_key() if has_key else None,
        home_app=home_app,
    )


@router.post('/settings', response_model=SettingsView)
async def post_settings(payload: SettingsPayload) -> SettingsView:
    # 只写存储：Key 落凭据文件，不回读
    if payload.api_key:
        settings.set_api_key(payload.api_key)
    if payload.default_model and payload.default_model not in _MODEL_IDS:
        raise HTTPException(
            status_code=400,
            detail={'error': 'unknown_model',
                    'message': f'未知模型 ID: {payload.default_model}'})
    # M17.12：default_model 与 home_app 合并为一次 read-modify-write
    # （save_user_settings 覆盖整文件，分次写会互相踩掉）
    if payload.default_model or payload.home_app is not None:
        data = settings.load_user_settings()
        if payload.default_model:
            data['default_model'] = payload.default_model
        if payload.home_app is not None:
            # '' → 清除偏好；后端不校验 app id（chat/settings 由前端静态注册，后端无清单）
            data['home_app'] = payload.home_app
        settings.save_user_settings(data)
    view = await get_settings()
    # M17.10：配置变更广播（模型清单/默认模型），其他终端局部刷新
    await broadcast_shell_event({'type': 'settings-changed'})
    return view


@router.post('/settings/test')
async def test_connection(payload: SettingsPayload) -> dict:
    """连通性测试：发一条最小请求，返回首个 chunk 或错误。"""
    if not settings.get_api_key():
        return {'ok': False, 'error': '未配置 API Key'}
    model = payload.default_model or settings.get_default_model()
    try:
        adapter = TokenHubAdapter()
        chunks = await asyncio.to_thread(
            list, adapter.stream(
                [{'role': 'user', 'content': 'ping'}], model=model))
    except Exception as e:
        log.exception('connectivity test failed')
        return {'ok': False, 'error': str(e)}

    text = ''.join(c.get('content', '') for c in chunks
                   if c.get('type') == 'text')
    return {'ok': True, 'model': model, 'sample': text[:80]}
