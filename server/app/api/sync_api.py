"""
WS /api/sync/ws/{room_id} —— 多端实时同步通道（M16）。

协议（客户端 → 服务端）：
  {"type": "hello",  "app": "quickdraw", "file": "<file_id>"}
  {"type": "doc",    "file": "<file_id>", "diff": { added, removed, updated }}
  {"type": "snapshot", "file": "<file_id>", "snapshot": {...}}
  {"type": "ping"}

协议（服务端 → 客户端）：
  {"type": "hello",    "room", "file", "rev", "snapshot", "peers"}
  {"type": "doc",     "file", "seq", "client_id", "diff"}
  {"type": "snapshot-ok", "file", "rev"}
  {"type": "pong"}
  {"type": "error",  "message"}

回声抑制：广播带上发起者的 client_id，发起者丢弃自己那条，其余客户端 applyDiff(..., 'remote')。
"""

import json
import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from .. import deps, settings

log = logging.getLogger('agentos.api.sync')

router = APIRouter(tags=['sync'])

# 文件索引的虚拟 file_id（房间级「有哪些画板」清单，也走同一张表）
INDEX_FILE = '__index__'


def _frame(msg: dict) -> str:
    return json.dumps(msg, ensure_ascii=False)


@router.get('/sync/index')
async def get_index(
    app: str = Query('quickdraw'),
    room: str = Query('main'),
) -> dict:
    """取房间的文件索引（多端一致的「有哪些画板」）"""
    rev, payload = deps.manager.ctx.get('sync').snapshot(
        app, room, INDEX_FILE,
    )
    return {'rev': rev, 'payload': payload}


@router.put('/sync/index')
async def put_index(
    body: dict,
    app: str = Query('quickdraw'),
    room: str = Query('main'),
) -> dict:
    """写回文件索引；随后广播给房间内其他客户端"""
    sync = deps.manager.ctx.get('sync')
    payload = body.get('payload') or {}
    sync.put_snapshot(app, room, INDEX_FILE, payload)
    sync.broadcast(app, room, INDEX_FILE,
                     {'type': 'index', 'rev': sync.max_seq(app, room, INDEX_FILE),
                      'payload': payload, 'client_id': body.get('client_id')})
    return {'ok': True}


@router.websocket('/sync/ws/{room_id}')
async def sync_socket(
    ws: WebSocket,
    room_id: str,
    app: str = Query('quickdraw'),
    file: str = Query('default'),
) -> None:
    sync = deps.manager.ctx.get('sync')
    if sync is None:
        await ws.close(code=1011, reason='sync-hub 未激活')
        return

    await ws.accept()
    sync.subscribe(app, room_id, file, ws)
    try:
        rev, snap = sync.snapshot(app, room_id, file)
        await ws.send_text(_frame({
            'type': 'hello', 'room': room_id, 'file': file,
            'rev': rev, 'snapshot': snap,
            'peers': sync.peers(app, room_id, file),
        }))

        while True:
            raw = await ws.receive_text()
            if len(raw.encode('utf-8')) > settings.SYNC_MAX_MSG:
                await ws.send_text(_frame({
                    'type': 'error', 'message': 'message too large'}))
                continue
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send_text(_frame({
                    'type': 'error', 'message': 'bad json'}))
                continue

            mtype = msg.get('type')
            if mtype == 'ping':
                await ws.send_text(_frame({'type': 'pong'}))
            elif mtype == 'doc':
                f = str(msg.get('file') or file)
                seq, peers = sync.publish(app, room_id, f, msg.get('diff') or {},
                                         msg.get('client_id'))
                await ws.send_text(_frame({
                    'type': 'ack', 'file': f, 'seq': seq}))
                payload = _frame({
                    'type': 'doc', 'file': f, 'seq': seq,
                    'client_id': msg.get('client_id'),
                    'diff': msg.get('diff') or {},
                })
                for p in peers:
                    if p is ws:
                        continue            # 不回发给自己
                    try:
                        await p.send_text(payload)
                    except Exception:
                        log.debug('peer 发送失败，跳过')
            elif mtype == 'snapshot':
                f = str(msg.get('file') or file)
                rev = sync.put_snapshot(app, room_id, f, msg.get('snapshot') or {})
                await ws.send_text(_frame({
                    'type': 'snapshot-ok', 'file': f, 'rev': rev}))
            elif mtype == 'index-get':
                rev, payload = sync.snapshot(app, room_id, '__index__')
                await ws.send_text(_frame({
                    'type': 'index', 'rev': rev, 'payload': payload}))
            elif mtype == 'index':
                rev = sync.put_snapshot(app, room_id, '__index__',
                                                   msg.get('payload') or {})
                await ws.send_text(_frame({
                    'type': 'index-ok', 'rev': rev}))
            else:
                await ws.send_text(_frame({
                    'type': 'error', 'message': f'unknown type {mtype}'}))
    except (WebSocketDisconnect, RuntimeError):
        pass
    except Exception:
        log.debug('sync 连接异常', exc_info=True)
    finally:
        sync.unsubscribe(app, room_id, file, ws)
