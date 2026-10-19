"""
demo 插件后端：DemoService（Service 类，provide=['demo']）

只读暴露一段 demo 文案，通过通用数据通道：
  snapshot()  → GET /api/apps/demo/state
无需写任何接口路由，前端用 api.getAppState('demo') 取即可。
"""

from app.cordis import Service

name = 'demo'
provide = ['demo']


class DemoService(Service):
    """示例插件：向后端暴露 demo 文案（仅演示数据通道）"""

    def __init__(self, ctx):
        super().__init__(ctx, 'demo')

    def snapshot(self) -> dict:
        return {
            'title': '示例插件 Demo',
            'subtitle': '这是一个用 Python + Vue 写的样例应用',
            'sections': [
                {
                    'emoji': '🧩',
                    'title': '一切皆插件',
                    'text': '内核只负责渲染壳与数据通道，界面与逻辑都下放给插件。',
                },
                {
                    'emoji': '🐍',
                    'title': 'Python 后端',
                    'text': '在 server/main.py 写一个 Service 类，snapshot() 就是 GET 接口，'
                            '无需自己写路由。',
                },
                {
                    'emoji': '💚',
                    'title': 'Vue 前端',
                    'text': '这里测试',
                },
            ],
        }
