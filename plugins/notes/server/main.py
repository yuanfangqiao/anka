"""
notes 插件后端：NotesService（Service 类，provide=['notes']）

内存存储笔记列表；通过通用数据通道暴露：
  snapshot()                    → GET /api/apps/notes/state
  add_note/toggle_pin/remove    → POST /api/apps/notes/call {"method": ...}
"""

from app.cordis import Service

name = 'notes'
provide = ['notes']


class NotesService(Service):
    """笔记数据服务 —— 人与 Agent 读写同一份数据（M5 联动的基础）"""

    def __init__(self, ctx):
        super().__init__(ctx, 'notes')
        self._seq = 4
        self._notes = [
            {'id': 1, 'title': 'Agent 架构分享大纲',
             'excerpt': '五种机制：一切皆插件、Context 服务仓库、inject 拓扑排序、五种事件分发、可逆副作用。配合 cordis-mini 讲。',
             'tag': '工作', 'time': '09:12', 'pinned': True, 'from_chat': False},
            {'id': 2, 'title': 'waterfall 洋葱模型要点',
             'excerpt': 'listener 必须调 next_fn()，忘记调是头号 bug 来源。前置 → 委派 → 后置，和 Django 中间件同构。',
             'tag': '架构', 'time': '昨天', 'pinned': False, 'from_chat': True},
            {'id': 3, 'title': 'PWA 安装验证清单',
             'excerpt': 'manifest 图标 192/512/maskable；localhost 可安装；断网刷新仍有 App Shell；iOS 需要 apple-touch-icon。',
             'tag': '清单', 'time': '周二', 'pinned': False, 'from_chat': False},
            {'id': 4, 'title': '插件面板交互草稿',
             'excerpt': '禁用 llm-runtime 时弹出级联提示：llm-echo、agent-loop、llm-logger 将被一起卸载。',
             'tag': '设计', 'time': '周一', 'pinned': False, 'from_chat': True},
        ]

    def snapshot(self) -> dict:
        return {'notes': self._notes}

    def add_note(self, title: str, excerpt: str = '', tag: str = '草稿') -> dict:
        self._seq += 1
        note = {'id': self._seq, 'title': title, 'excerpt': excerpt,
                'tag': tag, 'time': '刚刚', 'pinned': False, 'from_chat': False}
        self._notes.insert(0, note)
        return note

    def toggle_pin(self, id: int) -> dict | None:
        for n in self._notes:
            if n['id'] == id:
                n['pinned'] = not n['pinned']
                return n
        return None

    def remove_note(self, id: int) -> bool:
        before = len(self._notes)
        self._notes = [n for n in self._notes if n['id'] != id]
        return len(self._notes) < before
