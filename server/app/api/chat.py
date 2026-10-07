"""
POST /api/chat —— SSE 流式对话。

同步内核 → 异步 SSE 的桥接模式（见 ARCHITECTURE.md review 修正）：
- worker 线程跑 AgentLoop.run，经 on_event 回调把事件塞进 queue.Queue
- 异步生成器用 asyncio.to_thread(queue.get) 逐条取出并 yield SSE 帧
- 客户端断连（生成器被关闭）时置 cancel，worker 在下一个 chunk 处停下

M15：多会话（session_id 绑定 + 由会话日志投影多轮 history）+ 可终止。
"""

import asyncio
import json
import queue
import threading

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from .. import deps, settings
from ..plugins import session_log
from ..schemas import ChatRequest

router = APIRouter(tags=['chat'])


def _sse(payload: dict) -> str:
    return f'data: {json.dumps(payload, ensure_ascii=False)}\n\n'


@router.post('/chat')
async def chat(req: ChatRequest) -> StreamingResponse:
    q: queue.Queue = queue.Queue()
    cancel = threading.Event()
    session_id = req.session_id or session_log.new_session_id()

    def worker() -> None:
        try:
            agents = deps.manager.ctx.get('agents')
            if agents is None:
                q.put({'type': 'error',
                       'content': 'agent-loop 未激活，请到插件页检查 agent-loop / llm-runtime 状态'})
                return
            # 绑定会话：本轮所有 LLM/工具事件都记到同一会话文件
            session_log.bind(session_id)
            history = session_log.derive_messages(session_id)
            model = req.model
            if model in (None, '', 'default'):
                model = settings.get_default_model()
            agents.run(req.message, max_turns=req.max_turns, on_event=q.put,
                       model=model, history=history, cancel=cancel)
        except Exception as e:  # 内核异常必须转成事件，不能让客户端干等
            q.put({'type': 'error', 'content': str(e)})
        finally:
            session_log.unbind()
            q.put({'type': 'done'})

    async def event_stream():
        thread = threading.Thread(target=worker, daemon=True)
        thread.start()
        yield _sse({'type': 'session', 'session_id': session_id})
        try:
            while True:
                ev = await asyncio.to_thread(q.get)
                if ev.get('type') == 'done':
                    yield _sse({'type': 'done'})
                    break
                yield _sse(ev)
        except asyncio.CancelledError:
            # 客户端断连：通知 worker 终止（下一次 chunk 检查处生效）
            cancel.set()
            raise
        finally:
            cancel.set()

    return StreamingResponse(
        event_stream(),
        media_type='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
        },
    )
