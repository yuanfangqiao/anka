"""
cordis — 插件化 Agent 内核（vendor 自 reference/cordis-mini/cordis）。

相对原版的每处改动见同目录 PATCHES.md。
"""

from .context import ProxyContext, ReflectService, RootContext
from .events import BoundEventsProxy, EventsService, is_bailed
from .fiber import Fiber, FiberState
from .loader import Loader
from .registry import PluginMeta, extract_plugin_meta, resolve_inject
from .service import Service

__all__ = [
    'BoundEventsProxy',
    'EventsService',
    'Fiber',
    'FiberState',
    'Loader',
    'PluginMeta',
    'ProxyContext',
    'ReflectService',
    'RootContext',
    'Service',
    'extract_plugin_meta',
    'is_bailed',
    'resolve_inject',
]
