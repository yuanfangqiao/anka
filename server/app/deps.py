"""依赖注入：全局 PluginManager 单例 + 内核串行化锁"""

import asyncio

from .plugin_manager import PluginManager

manager = PluginManager()

# 所有内核变更（bootstrap / enable / disable）必须持锁串行；
# 内核是同步实现，配合 asyncio.to_thread 避免阻塞事件循环
kernel_lock = asyncio.Lock()
