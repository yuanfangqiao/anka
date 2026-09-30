"""
cordis.context — Context 与 Proxy 机制

对应 Cordis 的 vendor/cordis/src/context.ts + reflect.ts ProxyHandler。

PATCH: ReflectService 新增 discard_fiber()（见 PATCHES.md #5）。
"""


class ProxyContext:
    """
    带 __getattr__ 拦截的 Context。

    每个插件拿到的 ctx 都是 ProxyContext，绑定了自己的 fiber。
    """

    def __init__(self, root_ctx, fiber=None):
        object.__setattr__(self, '_root_ctx', root_ctx)
        object.__setattr__(self, '_fiber', fiber)

    @property
    def reflect(self):
        return self._root_ctx.reflect

    @property
    def events(self):
        """返回绑定当前 fiber 的 EventsService 代理"""
        from .events import BoundEventsProxy
        fiber = object.__getattribute__(self, '_fiber')
        return BoundEventsProxy(self._root_ctx.events, fiber)

    @property
    def fiber(self):
        return object.__getattribute__(self, '_fiber')

    @property
    def registry(self):
        return self._root_ctx.registry

    @property
    def _loading_fiber(self):
        """获取当前正在加载的 fiber（由 Loader 设置）"""
        return getattr(self._root_ctx, '_current_loading_fiber', None)

    def __getattr__(self, name):
        """拦截属性访问 —— 模拟 Cordis ProxyHandler.get"""
        fiber = object.__getattribute__(self, '_fiber')

        if fiber is not None:
            impl = fiber.store.get(name)
            if impl is not None:
                return impl
            current = fiber
            while current.parent_fiber is not None:
                current = current.parent_fiber
                impl = current.store.get(name)
                if impl is not None:
                    return impl

        root = object.__getattribute__(self, '_root_ctx')
        impl = root.reflect._get_impl(name)
        if impl is not None:
            return impl

        raise AttributeError(f'cannot get service "{name}" without inject')

    def get(self, name):
        """可选服务查找 —— 返回 None"""
        try:
            return getattr(self, name)
        except AttributeError:
            return None

    def __repr__(self):
        fiber = object.__getattribute__(self, '_fiber')
        fname = fiber.name if fiber else 'root'
        return f'<ProxyContext fiber={fname}>'


class ReflectService:
    """全局服务注册表"""

    def __init__(self):
        self._store: dict = {}
        self._all_fibers: list = []

    def _get_impl(self, name: str):
        return self._store.get(name)

    def provide(self, name: str, value, fiber):
        """注册服务到全局 store，返回 teardown"""
        if name in self._store:
            existing = self._store[name].get('_fiber_name', '?')
            raise ValueError(f'service "{name}" already registered by <{existing}>')

        self._store[name] = {'value': value, '_fiber_name': fiber.name}
        self.notify([name])

        def teardown():
            self._store.pop(name, None)
            self.notify([name])

        return teardown

    def get(self, name: str):
        impl = self._store.get(name)
        return impl['value'] if impl else None

    def notify(self, names: list):
        """通知所有 inject 了这些服务的 fiber 重新检查依赖状态"""
        for fiber in list(self._all_fibers):
            updated = False
            for name in names:
                if name in fiber.inject:
                    fiber._check_impl(name)
                    updated = True
            if updated:
                fiber._refresh()

    def discard_fiber(self, fiber):
        """PATCH #5：从 _all_fibers 摘除，供 PluginManager 重建 fiber 前清理死记录"""
        if fiber in self._all_fibers:
            self._all_fibers.remove(fiber)


class RootContext:
    """
    根 Context —— 持有 ReflectService、EventsService、registry。

    _current_loading_fiber：Loader 在加载插件时设置，
    让 Service 的 register 方法知道"谁在调用我"。
    """

    def __init__(self):
        self.reflect = ReflectService()
        from .events import EventsService
        self.events = EventsService(self)
        self.registry = {'plugins': {}, 'fibers': []}
        self._current_loading_fiber = None

    def create_proxy(self, fiber):
        return ProxyContext(self, fiber)

    def __getattr__(self, name):
        """从全局 reflect store 查找服务"""
        impl = self.reflect._get_impl(name)
        if impl is not None:
            return impl['value']
        raise AttributeError(f'cannot get service "{name}"')

    def get(self, name):
        try:
            return getattr(self, name)
        except AttributeError:
            return None
