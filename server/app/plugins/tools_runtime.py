"""
插件：ToolsRuntime（Service 类）

提供工具注册与执行能力 —— 在 ctx 上注册为 ctx.tools。
execute() 走三段 waterfall：pre-execute → execute → post-execute。
"""

from app.cordis import Service

name = 'tools-runtime'
provide = ['tools']


class Tools(Service):
    """工具注册表与执行引擎"""

    def __init__(self, ctx):
        super().__init__(ctx, 'tools')
        self._tools = {}

    def register(self, tool_def: dict):
        """
        注册工具定义，返回 disposer。

        关键：effect 注册到 CALLER 的 fiber（_loading_fiber），
        而不是 self.ctx.fiber（service 的 fiber）。
        这样消费者卸载时工具自动摘除。
        """
        tool_name = tool_def['name']

        # 用 caller 的 fiber，而不是 service 的 fiber
        caller_fiber = self.ctx._loading_fiber or self.ctx.fiber

        def setup():
            self._tools[tool_name] = tool_def

            def teardown():
                self._tools.pop(tool_name, None)

            return teardown

        return caller_fiber.effect(setup, f'tools.register({tool_name!r})')

    def list_tools(self) -> list:
        return list(self._tools.keys())

    def execute(self, tool_name: str, args: dict) -> str:
        """执行工具 —— 三段 waterfall 流水线"""
        tool = self._tools.get(tool_name)
        if tool is None:
            return f'error: tool "{tool_name}" not found'

        exec_ctx = {'tool_name': tool_name, 'args': args}

        # 第一段：pre-execute
        pre_result = self.ctx.events.serial('tools/pre-execute', exec_ctx)
        if pre_result == 'denied':
            return 'denied by pre-execute gate'

        # 第二段：execute（走 waterfall 允许拦截）
        result = self.ctx.events.waterfall(
            'tools/execute',
            exec_ctx,
            inner=lambda ctx=exec_ctx: tool['handler'](ctx['args']),
        )

        # 第三段：post-execute
        self.ctx.events.emit('tools/post-execute', exec_ctx, result)

        return result
