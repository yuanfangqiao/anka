"""
会话管理 API（M15）。

数据源是 session-log 插件的 append-only 日志（server/data/sessions/*.jsonl）：
- GET    /api/sessions            会话摘要列表（按最近更新倒序）
- GET    /api/sessions/{id}       会话完整气泡历史
- DELETE /api/sessions/{id}       删除会话
"""

from fastapi import APIRouter, HTTPException

from ..plugins import session_log
from ..schemas import ChatMessage, SessionDetail, SessionSummary

router = APIRouter(tags=['sessions'])


@router.get('/sessions', response_model=list[SessionSummary])
async def list_sessions() -> list:
    return session_log.list_sessions()


@router.get('/sessions/{session_id}', response_model=SessionDetail)
async def get_session(session_id: str) -> SessionDetail:
    messages = session_log.session_messages(session_id)
    if not messages:
        raise HTTPException(status_code=404,
                            detail={'error': 'not_found',
                                    'message': f'会话 {session_id} 不存在或为空'})
    title = next((m['text'][:24] for m in messages
                  if m['role'] == 'user' and m['text']), '新会话')
    return SessionDetail(
        id=session_id, title=title,
        messages=[ChatMessage(**m) for m in messages],
    )


@router.delete('/sessions/{session_id}')
async def delete_session(session_id: str) -> dict:
    return {'ok': session_log.delete_session(session_id)}
