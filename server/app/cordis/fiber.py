"""
cordis.fiber — Fiber 状态机与 effect 管理

对应 Cordis 的 vendor/cordis/src/fiber.ts。

Fiber 是插件的"事务边界"：
- 每次 ctx.effect(setup_fn) 注册一个副作用（setup + teardown）
- fiber 卸载时所有 teardown 逆序执行 —— 像数据库事务 ROLLBACK

Fiber 状态机：
  PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED
     ↑                                      │
     └──────────────────────────────────────┘
             依赖重新就位时可以恢复

PATCH: _run_disposers 的 print 改 logging（见 PATCHES.md #3）。
"""

import logging
from enum import IntEnum
from typing import Callable, Optional

log = logging.getLogger('cordis.fiber')


class FiberState(IntEnum):
    PENDING = 0      # 等待依赖就位
    LOADING = 1      # apply / __init__ 正在执行
    ACTIVE = 2       # 已就绪，对外提供服务
    FAILED = 3       # 配置或 apply 报错
    DISPOSED = 4     # 已卸载，不可恢复（PluginManager 可重建新 fiber）
    UNLOADING = 5    # teardown 正在执行


class Fiber:
    """
    插件的事务边界。

    disposables 栈：每个 teardown 是一个 callable。
    unload 时逆序执行（栈弹出），对应 Cordis 的 splice(0).reverse()。
    """

    def __init__(self, name: str, inject: dict, provide: list,
                 parent_fiber=None):
        self._name = name
        self._inject = inject
        self._provide = provide
        self._parent_fiber = parent_fiber
        self._state = FiberState.PENDING
        self.store: dict = {}
        self._disposables: list = []
        self._apply_fn = None
        self._proxy_ctx = None
        self._root_ctx = None

    # ─── Properties ──────────────────────────────────

    @property
    def name(self):
        return self._name

    @property
    def state(self):
        return self._state

    @property
    def inject(self):
        return self._inject

    @property
    def provide(self):
        return self._provide

    @property
    def parent_fiber(self):
        return self._parent_fiber

    @property
    def is_active(self):
        return self._state == FiberState.ACTIVE

    # ─── Effect 管理 ──────────────────────────────────

    def effect(self, setup_fn: Callable, label: str = 'anonymous') -> Callable:
        """
        注册一个副作用。

        setup_fn() 执行并返回 teardown callable。
        teardown 推入 disposables 栈，fiber 卸载时逆序执行。

        对应 Cordis fiber.effect()（fiber.ts:415-561）。
        """
        if self._state not in (FiberState.LOADING, FiberState.ACTIVE):
            raise RuntimeError(
                f'cannot register effect on fiber "{self._name}" '
                f'in state {self._state.name}'
            )
        teardown = setup_fn()
        if teardown is not None:
            self._disposables.append(teardown)

        def dispose():
            if teardown in self._disposables:
                self._disposables.remove(teardown)
                teardown()

        return dispose

    # ─── 依赖检查 ──────────────────────────────────

    def _check_impl(self, name: str):
        """检查指定依赖是否就绪，更新本地 store 缓存"""
        if self._root_ctx is None:
            return
        impl = self._root_ctx.reflect._get_impl(name)
        if impl is not None:
            self.store[name] = impl['value']
        else:
            self.store.pop(name, None)

    def _refresh(self):
        """
        根据依赖状态决定 fiber 状态切换。

        所有 inject 就位 + PENDING → LOADING → ACTIVE
        有 inject 缺失 + ACTIVE    → teardown → PENDING
        """
        all_ready = all(n in self.store for n in self._inject)

        if all_ready and self._state == FiberState.PENDING:
            self._state = FiberState.LOADING
            if self._apply_fn:
                try:
                    self._apply_fn(self._proxy_ctx)
                    self._state = FiberState.ACTIVE
                except Exception:
                    self._state = FiberState.FAILED
                    raise
            else:
                self._state = FiberState.ACTIVE

        elif not all_ready and self._state == FiberState.ACTIVE:
            self._run_disposers()
            self._state = FiberState.PENDING

    def _run_disposers(self):
        """逆序执行所有 teardown"""
        for td in reversed(self._disposables):
            try:
                td()
            except Exception as e:
                log.exception('teardown error in "%s": %s', self._name, e)
        self._disposables.clear()
        self.store.clear()

    # ─── 卸载 ──────────────────────────────────

    def unload(self):
        """
        卸载 fiber：级联卸载依赖者 → 逆序 teardown → DISPOSED。
        """
        if self._state in (FiberState.DISPOSED, FiberState.UNLOADING):
            return

        self._state = FiberState.UNLOADING

        # 级联：先卸载依赖我的 fiber
        if self._root_ctx:
            for name in self._provide:
                for fiber in list(self._root_ctx.registry['fibers']):
                    if fiber is not self and name in fiber.inject:
                        fiber.unload()

        self._run_disposers()
        self._state = FiberState.DISPOSED

    # ─── 诊断 ──────────────────────────────────

    def assert_active(self):
        if self._state not in (FiberState.ACTIVE, FiberState.LOADING):
            raise RuntimeError(
                f'fiber "{self._name}" is not active ({self._state.name})'
            )

    def __repr__(self):
        return f'Fiber({self._name}, {self._state.name})'
