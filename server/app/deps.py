"""依赖注入：全局 PluginManager 单例 + 内核串行化锁"""

import asyncio
import threading

from .plugin_manager import PluginManager

manager = PluginManager()

# 所有内核变更（bootstrap / enable / disable）必须持锁串行；
# 内核是同步实现，配合 asyncio.to_thread 避免阻塞事件循环
kernel_lock = asyncio.Lock()

# M14：跨线程互斥 —— agent 工作线程调用 harness 工具触达 manager 时，
# 与 API 层（asyncio.to_thread）并发竞争同一内核状态；asyncio.Lock 不跨线程，
# 故补一把 RLock。reload 串行化队列见 plugin_manager.reload_plugin。
kernel_rlock = threading.RLock()
