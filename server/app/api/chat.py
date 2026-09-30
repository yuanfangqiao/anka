"""
POST /api/chat —— SSE 流式对话。

同步内核 → 异步 SSE 的桥接模式（见 ARCHITECTURE.md review 修正）：
- worker 线程跑 AgentLoop.run，经 on_event 回调把事件塞进 queue.Queue
- 异步生成器用 asyncio.to_thread(queue.get) 逐条取出并 yield SSE 帧
- 客户端断连时（生成器被关闭）仅停止转发；worker 是短任务，随队列自然结束
"""

import asyncio
import json
import queue
import threading

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from .. import deps
from ..schemas import ChatRequest

router = APIRouter(tags=['chat'])


def _sse(payload: dict) -> str:
    return f'data: {json.dumps(payload, ensure_ascii=False)}\n\n'


@router.post('/chat')
async def chat(req: ChatRequest) -> StreamingResponse:
    q: queue.Queue = queue.Queue()

    def worker() -> None:
        try:
            agents = deps.manager.ctx.get('agents')
            if agents is None:
                q.put({'type': 'error',
                       'content': 'agent-loop 未激活，请到插件页检查 agent-loop / llm-runtime 状态'})
                return
            agents.run(req.message, max_turns=req.max_turns,
                       on_event=q.put)
        except Exception as e:  # 内核异常必须转成事件，不能让客户端干等
            q.put({'type': 'error', 'content': str(e)})
        finally:
            q.put({'type': 'done'})

    async def event_stream():
        thread = threading.Thread(target=worker, daemon=True)
        thread.start()
        try:
            while True:
                ev = await asyncio.to_thread(q.get)
                if ev.get('type') == 'done':
                    yield _sse({'type': 'done'})
                    break
                yield _sse(ev)
        except asyncio.CancelledError:
            # 客户端断连：停止转发
            raise

    return StreamingResponse(
        event_stream(),
        media_type='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
        },
    )
