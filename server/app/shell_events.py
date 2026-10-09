"""M17.10：shell 级事件广播 —— 运行时变化（插件装卸/配置变更）推给所有终端。

房间：app='shell', room='main', file='__shell__'（复用 M16 sync-hub 通道）。
前端 useShellSync 订阅同房间，收到即局部刷新，不整页 reload。
"""

import logging

from . import deps

log = logging.getLogger('agentos.shell_events')

APP_ID = 'shell'
ROOM_ID = 'main'
FILE_ID = '__shell__'


async def broadcast_shell_event(event: dict) -> None:
    """尽力广播；sync-hub 未激活或无订阅者时静默跳过。"""
    sync = deps.manager.ctx.get('sync')
    if sync is None:
        return
    try:
        await sync.broadcast(APP_ID, ROOM_ID, FILE_ID, event)
    except Exception:
        log.debug('shell 事件广播失败', exc_info=True)
