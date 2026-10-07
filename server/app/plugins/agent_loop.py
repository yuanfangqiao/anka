"""
插件：AgentLoop（Service 类 / Consumer）

消费 ctx.llm + ctx.tools，串起一次「对话」。只知道这两个接口，
不知道 Provider 是 TokenHub 还是 Echo —— 解耦的具体体现。

function calling 全链路（M13）：
- 从 ctx.tools.defs() 取工具 schema 传给 LLM
- 记录 assistant 消息（含 tool_calls）与 tool 结果（带 tool_call_id）
- 支持 system prompt、model 透传、多轮 history（由会话日志投影而来）

终止（M15）：
- cancel 为 threading.Event；每收一个 chunk 与每轮开头检查，置位即返回已产出文本
- 保证 UI「终止」按钮能即时停下，不出现永远转圈的挂死状态

对应 Cordis 的 packages/core/agent-loop/src/index.ts。
"""

import json

from app.cordis import Service

name = 'agent-loop'
inject = ['llm', 'tools']
provide = ['agents']

DEFAULT_SYSTEM = (
    '你是 AgentOS 的「插件开发」助手：把用户的需求做成一个可安装的 app 插件，并真正安装好。\n'
    '\n'
    '【插件契约】可写区只有 plugins/<id>/，固定三件套：\n'
    '1) plugin.json\n'
    '   {"id":"<id>","name":"<中文名>","icon":"<lucide 图标名，如 gamepad-2>",'
    '"version":"0.1.0","description":"...",\n'
    '    "backend":{"entry":"server/main.py"},'
    '"ui":{"entry":"web/index.js","dock":{"order":60},"route":"/<id>"}}\n'
    '2) server/main.py —— 即使纯前端插件也必须有，否则无法安装：\n'
    '   name = "<id>"\n   inject = []\n\n   def apply(ctx, config):\n       pass\n'
    '3) web/index.js —— export function setup(uiCtx) { ... }\n'
    '   内部用 const { vue, components, icons, registerApp } = uiCtx 取依赖，\n'
    '   最后 uiCtx.registerApp({ id, title, icon, route, order, component })。\n'
    '   禁止 import 任何 npm 包；vue / components / icons / api / toast / layout 只能从 uiCtx 解构。\n'
    '\n'
    '【工作纪律 —— 避免浪费轮数】\n'
    '- 不要读项目文档或内核源码，不要用 bash 探索目录：契约就在上面。\n'
    '- 标准流程：plugin_scaffold 起骨架 → fs_write 覆盖每个文件（一次写完整内容）→\n'
    '  plugin_verify 校验 → plugin_install 安装。\n'
    '- 一轮可以并行发起多个工具调用；读写文件一律用 fs_read / fs_write，不要用 bash。\n'
    '用简洁的中文回答；全部完成后给一句交付说明。'
)

STOPPED = '[已终止]'
MAX_TURNS_TEXT = (
    '已连续调用工具达到本轮上限，任务还没完成——'
    '回复「继续」，我会接着当前进度往下做。'
)


class AgentLoop(Service):
    def __init__(self, ctx):
        super().__init__(ctx, 'agents')

    def run(self, user_input, max_turns=100, on_event=None, model='default',
            system=None, history=None, cancel=None, image=None):
        emit = on_event or (lambda _ev: None)
        messages = []
        if system is None:
            system = DEFAULT_SYSTEM       # chat 层不传 system 时用默认守则
        if system:
            messages.append({'role': 'system', 'content': system})
        for m in (history or []):
            if m.get('role') != 'system':      # system 由本轮重新注入，避免重复
                messages.append(m)
        # M17：截屏修改 —— 附带截图时走 OpenAI vision 消息格式（content 数组）
        if image:
            content = [
                {'type': 'text', 'text': user_input},
                {'type': 'image_url', 'image_url': {'url': image}},
            ]
        else:
            content = user_input
        messages.append({'role': 'user', 'content': content})

        def cancelled() -> bool:
            return cancel is not None and cancel.is_set()

        for turn in range(max_turns):
            if cancelled():
                emit({'type': 'stopped'})
                return STOPPED

            tools = self.ctx.tools.defs() or None
            text_parts = []
            tool_calls = []
            stopped = False
            # M17：过程可视化 —— 显式「思考中」相位事件（供前端过程面板）
            emit({'type': 'status', 'phase': 'thinking', 'turn': turn + 1})

            for chunk in self.ctx.llm.stream(messages, model=model, tools=tools):
                if cancelled():
                    stopped = True
                    break
                ctype = chunk.get('type')
                if ctype == 'text':
                    content = chunk.get('content', '')
                    text_parts.append(content)
                    emit({'type': 'text_delta', 'content': content})
                elif ctype == 'tool_call':
                    tool_calls.append(chunk)

            if stopped:
                emit({'type': 'stopped'})
                return ''.join(text_parts) or STOPPED

            if not tool_calls:
                return ''.join(text_parts)

            # 1. assistant 消息（含 tool_calls）—— 就地补齐 call_id 供后续引用
            calls = []
            for i, tc in enumerate(tool_calls):
                tc['id'] = tc.get('id') or f'call_{turn}_{i}'
                calls.append({
                    'id': tc['id'],
                    'type': 'function',
                    'function': {
                        'name': tc['tool'],
                        'arguments': json.dumps(
                            tc.get('args', {}), ensure_ascii=False),
                    },
                })
            messages.append({
                'role': 'assistant',
                'content': None,
                'tool_calls': calls,
            })

            # 2. 逐工具执行，结果带 tool_call_id 回填
            for tc in tool_calls:
                emit({'type': 'tool_call', 'tool': tc['tool'],
                      'args': tc.get('args', {}), 'id': tc['id']})
                result = self.ctx.tools.execute(tc['tool'], tc.get('args', {}))
                emit({'type': 'tool_result', 'tool': tc['tool'],
                      'result': str(result)})
                messages.append({
                    'role': 'tool',
                    'tool_call_id': tc['id'],
                    'content': str(result),
                })

        # 关键：chat 层只消费 on_event，返回值会被丢弃——
        # 轮数耗尽时必须把提示作为事件发出去，否则 UI 永远空白（M15 前的「卡住」根因之一）
        emit({'type': 'text_delta', 'content': MAX_TURNS_TEXT})
        return MAX_TURNS_TEXT


def apply(ctx, config):
    return AgentLoop(ctx)
