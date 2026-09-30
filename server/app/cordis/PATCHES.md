# PATCHES · 相对 reference/cordis-mini/cordis 的改动记录

> 规则（见 AGENT.md）：每改一处内核，在此追加一行。原版是只读教学实现，本目录是唯一可演进副本。

| # | 文件 | 改动 | 原因 |
|---|------|------|------|
| 1 | `loader.py` | `bootstrap()` 新增 `package='app.plugins'` 参数，模块名改为 `f'{package}.{file}'`（原版硬编码 `plugins.`） | 服务端包结构为 `app.plugins`，硬编码无法 import |
| 2 | `loader.py` | 扫描失败的 `print` 改 `logging.error`；`parent_dir` 修正为插件目录的上两级（适配 `server/app/plugins` 布局） | 服务端不 print；原版布局 `cordis-mini/plugins` 与本项目 `server/app/plugins` 层级不同 |
| 3 | `fiber.py` | `_run_disposers()` 的 `print` 改 `logging.exception` | 服务端统一日志 |
| 4 | `loader.py` | 新增 `remove_fiber(fiber)`：从 `registry['fibers']` 摘除 | `enable` 重建 fiber 前必须清理旧 DISPOSED 记录，否则 `get_fiber` 拿到死 fiber、`unload_plugin` 级联遍历重复条目 |
| 5 | `context.py` | `ReflectService` 新增 `discard_fiber(fiber)`：从 `_all_fibers` 摘除 | 原版 `_all_fibers` 只增不减，反复启停会累积死 fiber，`notify` 白跑 |
| 6 | `events.py` | 不改代码，仅注明：`serial` 与 `bail` 实现同构是有意保留，对齐 Cordis 的 API 形态 | 避免后人误以为重复代码而误删 |
| 7 | `events.py` | 不改代码，仅注明：`on()` 的「兜底取最后一个 active fiber」分支在多 fiber 下不可靠，**约定调用方必须走 `ctx.events`**（BoundEventsProxy 自动带 fiber） | 线程安全与归因正确性 |
| 8 | `loader.py` | `get_fiber()` 改为倒序查找，返回最新同名 fiber | 防御：即使存在历史 DISPOSED 记录也拿到活的那个 |

## 未改但已知限制（继承自 cordis-mini）

- 核心为同步实现：服务端经 `PluginManager` + `asyncio.Lock` + `asyncio.to_thread` 调用
- `parallel` 用 `ThreadPoolExecutor` 模拟；`ExceptionGroup` 需 Python 3.11+
- 无类型安全、无 isolation scope、单进程
