"""
插件：LlmRuntime（Service 类）

提供 LLM 能力 —— 在 ctx 上注册为 ctx.llm。
管理 adapter 注册表，stream() 走 waterfall 允许拦截。
"""

from app.cordis import Service

name = 'llm-runtime'
provide = ['llm']


class LlmAdapter:
    """Provider 必须实现的抽象基类（Service Definition）"""
    def stream(self, messages, model, **kwargs):
        raise NotImplementedError


class LlmRuntime(Service):
    """LLM 能力运行时 —— Service 类插件"""

    def __init__(self, ctx):
        super().__init__(ctx, 'llm')
        self.adapters = {}

    def register_adapter(self, providers: list, adapter: LlmAdapter):
        """
        注册 adapter，返回 handle（可 replace / dispose）。

        effect 注册到 CALLER 的 fiber，消费者卸载时 adapter 自动摘除。
        """
        owned = set()
        released = False

        # ★ 用 caller 的 fiber
        caller_fiber = self.ctx._loading_fiber or self.ctx.fiber

        def setup():
            for p in providers:
                self.adapters[p] = adapter
                owned.add(p)

            def teardown():
                nonlocal released
                released = True
                for p in list(owned):
                    self.adapters.pop(p, None)
                owned.clear()

            return teardown

        dispose = caller_fiber.effect(setup, 'llm.registerAdapter()')

        class Handle:
            def __call__(self_handle):
                dispose()

            def replace(self_handle, next_providers):
                if released:
                    raise RuntimeError('disposed registration cannot replace')
                for p in list(owned):
                    self.adapters.pop(p, None)
                owned.clear()
                for p in next_providers:
                    self.adapters[p] = adapter
                    owned.add(p)

        return Handle()

    def stream(self, messages, model='default', **kwargs):
        """LLM 流式调用 —— 走 waterfall"""
        adapter = None
        for prefix, adp in self.adapters.items():
            if model.startswith(prefix) or model == 'default':
                adapter = adp
                break
        if adapter is None and self.adapters:
            adapter = next(iter(self.adapters.values()))

        def inner_call(*_a, **_kw):
            if adapter is None:
                return iter([{'type': 'text', 'content': '[no adapter]'}])
            return adapter.stream(messages, model=model, **kwargs)

        return self.ctx.events.waterfall(
            'llm/stream',
            {'messages': messages, 'model': model},
            inner=inner_call,
        )
