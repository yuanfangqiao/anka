"""
explore 插件后端：ExploreService（Service 类，provide=['explore']）

Agent 活动动态流。种子数据来自真实启动事件；
record() 供其他插件/内核写入新事件（M5 接 ctx.events 直播）。
"""

from app.cordis import Service

name = 'explore'
provide = ['explore']


class ExploreService(Service):
    def __init__(self, ctx):
        super().__init__(ctx, 'explore')
        self._seq = 6
        self._feed = [
            {'id': 1, 'kind': 'plugin', 'title': 'agent-loop 进入 ACTIVE',
             'detail': 'inject 依赖 llm、tools 全部就位，拓扑序第 5 个加载', 'time': '09:30:04'},
            {'id': 2, 'kind': 'chat', 'title': '完成一轮对话',
             'detail': 'llm/stream 经 llm-logger waterfall 包裹，耗时 12ms', 'time': '09:31:18'},
            {'id': 3, 'kind': 'tool', 'title': 'tool-bash 执行 ls server/app',
             'detail': 'tools.execute 事件 serial 分发，首个 listener 接手', 'time': '09:31:19'},
            {'id': 4, 'kind': 'plugin', 'title': 'llm-logger 注册瀑布监听',
             'detail': 'ctx.events.on("llm/stream") 走 fiber.effect，可逆', 'time': '09:30:03'},
            {'id': 5, 'kind': 'tool', 'title': 'tools-runtime 注册 bash 工具',
             'detail': 'register 返回 teardown，禁用插件时自动摘除', 'time': '09:30:02'},
            {'id': 6, 'kind': 'plugin', 'title': 'llm-echo 挂载 Echo Adapter',
             'detail': 'ctx.llm.register_adapter(["echo"], EchoAdapter)', 'time': '09:30:01'},
        ]

    def snapshot(self) -> dict:
        return {'feed': self._feed}

    def record(self, kind: str, title: str, detail: str = '',
               time: str = '刚刚') -> dict:
        self._seq += 1
        item = {'id': self._seq, 'kind': kind, 'title': title,
                'detail': detail, 'time': time}
        self._feed.insert(0, item)
        return item
