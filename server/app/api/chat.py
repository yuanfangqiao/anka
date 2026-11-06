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
import re
from contextlib import nullcontext

from fastapi import APIRouter, HTTPException, Request

from .. import auth, deps, run_manager, settings
from ..plugins import session_log, web_use
from ..schemas import ChatRequest, ChatStarted
from ..web_use.bridge import WebUseError
from .web_use import check_origin, service

router = APIRouter(tags=['chat'])


@router.post('/chat')
async def chat(req: ChatRequest, request: Request) -> ChatStarted:
    session_id = req.session_id or session_log.new_session_id()
    model = req.model
    if model in (None, '', 'default'):
        model = settings.get_default_model()

    owner = peer = lease = broker = None
    if req.web_client_id is not None:
        check_origin(request)
        owner = auth.current_user(request)
        if not owner or not re.fullmatch(r'[a-f0-9]{32}', session_id):
            raise HTTPException(400, '网页操作会话无效')
        if not req.web_client_id or len(req.web_client_id) > 64:
            raise HTTPException(400, '网页操作窗口无效')
        broker = service()
        try:
            peer = broker.get_peer(owner, req.web_client_id)
            lease = peer.reserve()
        except WebUseError as exc:
            raise HTTPException(409, str(exc)) from exc

    run = run_manager.manager.create(session_id, req.message, model, owner=owner)

    def worker() -> None:
        try:
            with (broker.bind(peer, lease, run.cancel) if broker else nullcontext()):
                agents = deps.manager.ctx.get('agents')
                if agents is None:
                    run.emit({'type': 'error',
                              'content': 'agent-loop 未激活，请到插件页检查 agent-loop / llm-runtime 状态'})
                    return
                session_log.bind(session_id, transient=peer is not None)
                history = session_log.derive_messages(session_id)
                options = {'system': web_use.SYSTEM, 'allowed_tools': web_use.TOOLS} if peer else {}
                agents.run(req.message, max_turns=min(req.max_turns, 24) if peer else req.max_turns,
                           on_event=run.emit, model=model, history=history, cancel=run.cancel,
                           images=req.images, **options)
                if peer:
                    # 保留对话气泡；不写入页面内容、工具参数和画面。
                    session_log.record_web_turn(session_id, model, history, req.message, req.images, run.events)
        except Exception as e:  # 内核异常必须转成事件，不能让客户端干等
            run.emit({'type': 'error', 'content': str(e)})
        finally:
            session_log.unbind()
            run.emit({'type': 'done'})

    threading.Thread(target=worker, daemon=True).start()
    return ChatStarted(run_id=run.id, session_id=session_id)
