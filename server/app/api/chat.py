"""
POST /api/chat —— 启动一次对话 run（M17 重构）。

契约变化（M15 → M17）：
- M15：POST 直接返回 SSE 流，客户端断连即取消
- M17：POST 只负责启动，立即返回 {run_id, session_id}；
  事件流经 GET /api/runs/{id}/stream 订阅（断点重放 + 续传，见 runs.py）。
  run 由服务端 RunManager 常驻执行——客户端切后台/刷新页面不中断，
  只有 POST /api/runs/{id}/stop 才显式终止。

worker 线程模型不变：AgentLoop.run 在独立线程执行，事件经 run.emit
缓冲并广播；会话日志绑定不变（权威事件源仍是 sessions/<id>.jsonl）。
"""

import threading

from fastapi import APIRouter

from .. import deps, run_manager, settings
from ..plugins import session_log
from ..schemas import ChatRequest, ChatStarted

router = APIRouter(tags=['chat'])


@router.post('/chat')
async def chat(req: ChatRequest) -> ChatStarted:
    session_id = req.session_id or session_log.new_session_id()
    model = req.model
    if model in (None, '', 'default'):
        model = settings.get_default_model()

    run = run_manager.manager.create(session_id, req.message, model)

    def worker() -> None:
        try:
            agents = deps.manager.ctx.get('agents')
            if agents is None:
                run.emit({'type': 'error',
                          'content': 'agent-loop 未激活，请到插件页检查 agent-loop / llm-runtime 状态'})
                return
            # 绑定会话：本轮所有 LLM/工具事件都记到同一会话文件
            session_log.bind(session_id)
            history = session_log.derive_messages(session_id)
            agents.run(req.message, max_turns=req.max_turns, on_event=run.emit,
                       model=model, history=history, cancel=run.cancel,
                       images=req.images)
        except Exception as e:  # 内核异常必须转成事件，不能让客户端干等
            run.emit({'type': 'error', 'content': str(e)})
        finally:
            session_log.unbind()
            run.emit({'type': 'done'})

    threading.Thread(target=worker, daemon=True).start()
    return ChatStarted(run_id=run.id, session_id=session_id)
