"""
cordis.events — 五种事件分发模式

对应 Cordis 的 vendor/cordis/src/events.ts。

五种模式：
  emit     : fire-and-forget（logging 广播）
  parallel : 并发 + 聚合错误（asyncio.gather）
  serial   : 逐个执行，bail 短路（Django middleware 链）
  bail     : 同步短路版 serial（与 serial 同构，保留以对齐 Cordis API，见 PATCHES.md #6）
  waterfall: 洋葱模型（WSGI/Django 中间件）

listener 注册走 fiber.effect，卸载时自动摘除。
"""

from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Optional


def is_bailed(value) -> bool:
    """
    None / False 表示"我不接手"，其他值表示"我截胡了"。
    对应 Cordis isBailed（events.ts:13-15）。
    """
    return value is not None and value is not False


class _Hook:
    __slots__ = ('callback', 'prepend')

    def __init__(self, callback, prepend=False):
        self.callback = callback
        self.prepend = prepend


class EventsService:
    """
    事件总线，支持五种分发模式。

    listener 注册走 fiber.effect，卸载时自动摘除。
    对应 Cordis EventsService（events.ts:131-352）。
    """

    def __init__(self, root_ctx):
        self._root_ctx = root_ctx
        self._hooks: dict = {}

    # ─── 五种分发模式 ──────────────────────────────────

    def emit(self, name: str, *args):
        """广播：所有 listener 同步调用一次，不等结果"""
        for cb in self._dispatch(name):
            cb(*args)

    def parallel(self, name: str, *args):
        """并发：ThreadPoolExecutor 模拟 Promise.allSettled"""
        cbs = self._dispatch(name)
        if not cbs:
            return []
        with ThreadPoolExecutor(max_workers=len(cbs)) as pool:
            futures = [pool.submit(cb, *args) for cb in cbs]
            results, errors = [], []
            for f in futures:
                try:
                    results.append(f.result())
                except Exception as e:
                    errors.append(e)
        if errors:
            raise ExceptionGroup('parallel errors', errors)
        return results

    def serial(self, name: str, *args):
        """顺序执行，遇到 bail 值短路返回"""
        for cb in self._dispatch(name):
            result = cb(*args)
            if is_bailed(result):
                return result
        return None

    def bail(self, name: str, *args):
        """同步短路版 serial（与 serial 同构，保留以对齐 Cordis API）"""
        for cb in self._dispatch(name):
            result = cb(*args)
            if is_bailed(result):
                return result
        return None

    def waterfall(self, name: str, *args, inner: Callable):
        """
        洋葱模型：listener 从外到内包裹 inner。

        每个 listener 收到 (*args, next_fn=<next>)。
        - 调 next_fn() → 委派给下一层
        - 不调 → 短路

        硬约束：必须调 next_fn()，忘记调是头号 bug 来源。
        """
        cbs = list(self._dispatch(name))

        def make_chain(remaining):
            def next_fn():
                if remaining:
                    cb = remaining.pop(0)
                    return cb(*args, next_fn=make_chain(remaining))
                return inner(*args)
            return next_fn

        return make_chain(cbs)()

    # ─── 分发与注册 ──────────────────────────────────

    def _dispatch(self, name: str) -> list:
        return [h.callback for h in self._hooks.get(name, [])]

    def on(self, name: str, listener: Callable, prepend: bool = False,
           fiber=None) -> Callable:
        """
        注册事件 listener。

        内部走 fiber.effect：setup 加入 hooks，teardown 从 hooks 删除。
        fiber 卸载 → teardown 自动跑 → listener 消失。

        fiber 参数由 ProxyContext 的 events 属性自动注入。
        注意：调用方应走 ctx.events（BoundEventsProxy）显式携带 fiber；
        下面的兜底分支仅兼容直连场景，多 fiber 下不可靠（见 PATCHES.md #7）。
        """
        if fiber is None:
            # 兜底：从 registry 找最后一个 active fiber
            for f in reversed(self._root_ctx.registry.get('fibers', [])):
                if f.is_active:
                    fiber = f
                    break

        if fiber:
            fiber.assert_active()

        hooks = self._hooks.setdefault(name, [])
        hook = _Hook(listener, prepend)

        if prepend:
            hooks.insert(0, hook)
        else:
            hooks.append(hook)

        def unregister():
            if hook in hooks:
                hooks.remove(hook)

        if fiber:
            fiber._disposables.append(unregister)

        return unregister


class BoundEventsProxy:
    """
    绑定 fiber 的 EventsService 代理。

    ProxyContext.events 返回此代理，确保 on() 注册到正确的 fiber。
    其他方法直接透传给底层 EventsService。
    """

    def __init__(self, events_service, fiber):
        object.__setattr__(self, '_events', events_service)
        object.__setattr__(self, '_fiber', fiber)

    def on(self, name, listener, prepend=False):
        return self._events.on(
            name, listener, prepend=prepend,
            fiber=object.__getattribute__(self, '_fiber'),
        )

    def __getattr__(self, name):
        return getattr(object.__getattribute__(self, '_events'), name)
