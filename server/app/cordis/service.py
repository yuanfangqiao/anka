"""
cordis.service — Service 基类

对应 Cordis 的 vendor/cordis/src/service.ts。

Service 类插件只需继承 Service 并调用 super().__init__(ctx, 'name')，
就能自动把自身注册到 ctx 上，成为 ctx.<name>。

关键一行：ctx.reflect.provide(name, self, fiber)
→ 调用完，ctx.llm 就是 self。
"""


class Service:
    """所有 Service 类插件的基类"""

    def __init__(self, ctx, name: str):
        self._ctx = ctx
        self._name = name
        fiber = ctx.fiber

        # 注册到全局 store（provide 返回 teardown）
        teardown = ctx.reflect.provide(name, self, fiber)
        fiber._disposables.append(teardown)

        # 同时记到 fiber.store（供 __getattr__ 快速查找）
        fiber.store[name] = self

    @property
    def ctx(self):
        return self._ctx

    @property
    def name(self):
        return self._name
