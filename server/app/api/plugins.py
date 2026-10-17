"""插件管理接口：GET /api/plugins、POST /api/plugins/{name}/enable|disable"""

import asyncio
import logging

from fastapi import APIRouter, HTTPException

from .. import deps
from ..plugin_service import ServiceError
from ..schemas import (AvailablePlugin, InstallResult, PluginActionResult,
                       PluginInfo)
from ..shell_events import broadcast_shell_event

log = logging.getLogger('agentos.api.plugins')
router = APIRouter(tags=['plugins'])

# 稳定错误码 → HTTP（docs/PLUGIN-SPEC.md §5）
_CODE_STATUS = {
    'E_NOT_FOUND': 404,
    'E_NOT_INSTALLED': 404,
    'E_ALREADY_INSTALLED': 409,
    'E_RESTART_REQUIRED': 409,
    'E_LOAD_FAILED': 500,
    'E_LEDGER_CORRUPT': 500,
    'E_BUILD_FAILED': 500,
    'E_NO_BUILD': 400,
}
_DEFAULT_STATUS = 422


def _locked(fn, *args, **kwargs):
    """内核变更同时持 asyncio.Lock（外层）与 threading.RLock（内层跨线程）。

    harness 工具在 agent 工作线程里直接调 manager 并持 kernel_rlock；
    API 层经 to_thread 的 manager 调用若不持 rlock，会与 harness 线程并发竞争。
    """
    with deps.kernel_rlock:
        return fn(*args, **kwargs)


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
            result = await asyncio.to_thread(_locked, deps.manager.install, name)
        except ServiceError as e:
            status = _CODE_STATUS.get(e.code, _DEFAULT_STATUS)
            error = ('plugin_not_found' if e.code == 'E_NOT_FOUND'
                     else 'manifest_invalid')
            raise HTTPException(
                status_code=status,
                detail={'error': error, 'code': e.code,
                        'message': str(e), 'plugin': name})
        except KeyError:
            raise HTTPException(
                status_code=404,
                detail={'error': 'plugin_not_found', 'code': 'E_NOT_FOUND',
                        'message': f'plugins/ 目录下未发现插件 "{name}"'})
    # M17.10：广播 shell 事件，其他终端即时增量加载（不持内核锁发网络帧）
    await broadcast_shell_event(
        {'type': 'plugins-changed', 'action': 'install', 'name': name})
    return result


@router.post('/{name}/build', response_model=PluginActionResult)
async def build_plugin(name: str) -> PluginActionResult:
    """源码型 page 插件：重跑 manifest.build.steps（dist 不入库，拉源码后构建）"""
    async with deps.kernel_lock:
        try:
            result = await asyncio.to_thread(_locked, deps.manager.build, name)
        except ServiceError as e:
            raise HTTPException(
                status_code=_CODE_STATUS.get(e.code, _DEFAULT_STATUS),
                detail={'error': 'build_failed', 'code': e.code,
                        'message': str(e), 'plugin': name})
        except KeyError:
            raise HTTPException(
                status_code=404,
                detail={'error': 'plugin_not_found', 'code': 'E_NOT_FOUND',
                        'message': f'plugins/ 目录下未发现插件 "{name}"'})
    await broadcast_shell_event(
        {'type': 'plugins-changed', 'action': 'build', 'name': name})
    return result


@router.post('/{name}/uninstall', response_model=PluginActionResult)
async def uninstall_plugin(name: str) -> PluginActionResult:
    async with deps.kernel_lock:
        try:
            result = await asyncio.to_thread(_locked, deps.manager.uninstall, name)
        except KeyError:
            raise HTTPException(
                status_code=404,
                detail={'error': 'plugin_not_installed', 'code': 'E_NOT_INSTALLED',
                        'message': f'插件 "{name}" 未安装'})
    # M17.10：广播 shell 事件，其他终端即时移除
    await broadcast_shell_event(
        {'type': 'plugins-changed', 'action': 'uninstall', 'name': name})
    return result


async def _run_action(name: str, action: str) -> PluginActionResult:
    fn = deps.manager.enable if action == 'enable' else deps.manager.disable
    async with deps.kernel_lock:
        try:
            result = await asyncio.to_thread(_locked, fn, name)
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
    # M17.10：启停也影响 dock 可见性，广播给其他终端
    await broadcast_shell_event(
        {'type': 'plugins-changed', 'action': action, 'name': name})
    return result


@router.post('/{name}/enable', response_model=PluginActionResult)
async def enable_plugin(name: str) -> PluginActionResult:
    return await _run_action(name, 'enable')


@router.post('/{name}/disable', response_model=PluginActionResult)
async def disable_plugin(name: str) -> PluginActionResult:
    return await _run_action(name, 'disable')
