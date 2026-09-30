"""插件管理接口：GET /api/plugins、POST /api/plugins/{name}/enable|disable"""

import asyncio
import logging

from fastapi import APIRouter, HTTPException

from .. import deps
from ..schemas import (AvailablePlugin, InstallResult, PluginActionResult,
                       PluginInfo)

log = logging.getLogger('agentos.api.plugins')
router = APIRouter(tags=['plugins'])


@router.get('', response_model=list[PluginInfo])
async def list_plugins() -> list[PluginInfo]:
    return await asyncio.to_thread(deps.manager.list_plugins)


@router.get('/available', response_model=list[AvailablePlugin])
async def list_available() -> list[AvailablePlugin]:
    """可安装：扫描 plugins/ 目录发现但未安装"""
    return await asyncio.to_thread(deps.manager.available)


@router.post('/{name}/install', response_model=InstallResult)
async def install_plugin(name: str) -> InstallResult:
    async with deps.kernel_lock:
        try:
            return await asyncio.to_thread(deps.manager.install, name)
        except KeyError:
            raise HTTPException(
                status_code=404,
                detail={'error': 'plugin_not_found',
                        'message': f'plugins/ 目录下未发现插件 "{name}"'})
        except ValueError as e:
            raise HTTPException(
                status_code=400,
                detail={'error': 'manifest_invalid', 'message': str(e)})


@router.post('/{name}/uninstall', response_model=PluginActionResult)
async def uninstall_plugin(name: str) -> PluginActionResult:
    async with deps.kernel_lock:
        try:
            return await asyncio.to_thread(deps.manager.uninstall, name)
        except KeyError:
            raise HTTPException(
                status_code=404,
                detail={'error': 'plugin_not_installed',
                        'message': f'插件 "{name}" 未安装'})


async def _run_action(name: str, action: str) -> PluginActionResult:
    fn = deps.manager.enable if action == 'enable' else deps.manager.disable
    async with deps.kernel_lock:
        try:
            return await asyncio.to_thread(fn, name)
        except KeyError:
            raise HTTPException(
                status_code=404,
                detail={'error': 'plugin_not_found',
                        'message': f'插件 "{name}" 不存在'})
        except Exception as e:
            log.exception('%s %s failed', action, name)
            raise HTTPException(
                status_code=500,
                detail={'error': f'{action}_failed', 'message': str(e)})


@router.post('/{name}/enable', response_model=PluginActionResult)
async def enable_plugin(name: str) -> PluginActionResult:
    return await _run_action(name, 'enable')


@router.post('/{name}/disable', response_model=PluginActionResult)
async def disable_plugin(name: str) -> PluginActionResult:
    return await _run_action(name, 'disable')
