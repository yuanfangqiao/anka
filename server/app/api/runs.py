"""
/api/runs —— 对话 run 的订阅与管理（M17）。

- GET  /api/runs                 全部 run 摘要（活动优先，供页面刷新后重挂）
- GET  /api/runs/{id}/stream     SSE：先重放 after 之后的缓冲事件，再续传现场；
                                 客户端断连不取消 run，重连带 after=游标 无重无漏
- POST /api/runs/{id}/stop       显式终止（置 cancel，worker 在下一 chunk 处停下）
"""

import asyncio
import json
import queue

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from .. import run_manager
from ..schemas import RunInfo

router = APIRouter(tags=['runs'])


def _sse(payload: dict) -> str:
    return f'data: {json.dumps(payload, ensure_ascii=False)}\n\n'


@router.get('/runs')
async def list_runs() -> list[RunInfo]:
    return run_manager.manager.list()


@router.get('/runs/{run_id}/stream')
async def stream_run(run_id: str, after: int = 0) -> StreamingResponse:
    run = run_manager.manager.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail={
            'error': 'not_found', 'message': f'run {run_id} 不存在或已回收'})

    async def event_stream():
        replay, q = run.subscribe(after)
        try:
            for ev in replay:
                yield _sse(ev)
            if q is None:          # run 已结束，重放即全部
                return
            while True:
                try:
                    ev = await asyncio.to_thread(q.get, True, 15)
                except queue.Empty:
                    yield ': ping\n\n'      # 心跳，防代理掐断空闲连接
                    continue
                yield _sse(ev)
                if ev.get('type') == 'done':
                    return
        finally:
            if q is not None:
                run.unsubscribe(q)

    return StreamingResponse(
        event_stream(),
        media_type='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
    )


@router.post('/runs/{run_id}/stop')
async def stop_run(run_id: str) -> dict:
    run = run_manager.manager.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail={
            'error': 'not_found', 'message': f'run {run_id} 不存在或已回收'})
    run.cancel.set()
    return {'ok': True, 'id': run_id, 'active': not run.done}
