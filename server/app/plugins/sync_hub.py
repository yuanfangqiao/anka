"""
插件：sync-hub（Service / 通用内核能力）

提供 ctx.sync —— 多端实时同步的房间注册表与广播（M16）。

设计要点：
- 房间键 = (app_id, room_id, file_id)；文件索引存 file_id='__index__'
- 服务端权威定序：publish 由 SQLite op-log 分配单调 seq（BEGIN IMMEDIATE），再广播
- 回声抑制：广播带上 client_id，发起者丢弃自己那条
- 生命周期：房间表是进程内存态，随 fiber 卸载清理干净

对应 Cordis 的 packages/sync/src/index.ts。
"""

import json
import logging
import threading

from app import settings
from app.cordis import Service
from app.plugins import sync_store

log = logging.getLogger('agentos.sync_hub')

name = 'sync-hub'
inject = []
provide = ['sync']


def merge_diff(snapshot: dict, diff: dict) -> dict:
    """把引擎 diff 合并进快照（LWW：updated 取 to）。

    diff 形状：{ added: {id: rec}, removed: {id: rec}, updated: {id: [from, to]} }
    记录不可变 → 更新即替换对象，因此 [from, to] 始终成立。
    """
    doc = dict(snapshot or {})
    store = dict((doc.get('document') or {}).get('store') or {})
    for rid in (diff.get('removed') or {}):
        store.pop(rid, None)
    for rid, rec in (diff.get('added') or {}).items():
        store[rid] = rec
    for rid, pair in (diff.get('updated') or {}).items():
            store[rid] = pair[1]
    doc['document'] = {'store': store}
    return doc


class SyncHub(Service):
    """房间注册表 + 定序广播（通用，不绑定具体插件）"""

    def __init__(self, ctx):
        super().__init__(ctx, 'sync')
        self._rooms: dict = {}
        self._lock = threading.RLock()

    # ─── 订阅管理 ──────────────────────────────────────

    def subscribe(self, app_id: str, room_id: str, file_id: str, ws) -> None:
        with self._lock:
            self._rooms.setdefault((app_id, room_id, file_id), set()).add(ws)
            log.info('sync join %s/%s/%s peers=%d', app_id, room_id, file_id,
                     len(self._rooms[(app_id, room_id, file_id)]))

    def unsubscribe(self, app_id: str, room_id: str, file_id: str, ws) -> None:
        with self._lock:
            peers = self._rooms.get((app_id, room_id, file_id))
            if not peers:
                return
            peers.discard(ws)
            if not peers:
                del self._rooms[(app_id, room_id, file_id)]

    def peers(self, app_id: str, room_id: str, file_id: str) -> int:
        with self._lock:
            return len(self._rooms.get((app_id, room_id, file_id), ()))

    # ─── 定序与合并 ──────────────────────────────────

    def publish(self, app_id: str, room_id: str, file_id: str,
                diff: dict, client_id: str | None = None) -> tuple[int, list]:
        """落 op-log → 合并进快照 → 返回 (seq, 房间内所有连接)。
        广播由 async 侧发起（本方法只做持久化与取 peer 列表）。"""
        seq = sync_store.append_op(app_id, room_id, file_id, diff, client_id)
        snapshot = merge_diff(sync_store.get_doc(app_id, room_id, file_id)[1], diff)
        sync_store.save_doc(app_id, room_id, file_id, seq, snapshot)
        with self._lock:
            return seq, list(self._rooms.get((app_id, room_id, file_id), ()))

    # ─── 快照 / 追帧 / 回放 ──────────────────────────────

    def snapshot(self, app_id: str, room_id: str, file_id: str):
        return sync_store.get_doc(app_id, room_id, file_id)

    def put_snapshot(self, app_id: str, room_id: str, file_id: str,
                     snapshot: dict) -> int:
        rev = sync_store.max_seq(app_id, room_id, file_id)
        sync_store.save_doc(app_id, room_id, file_id, rev, snapshot or {})
        return rev

    def since(self, app_id: str, room_id: str, file_id: str,
              since: int = 0):
        return sync_store.ops_since(app_id, room_id, file_id, since)

    def compact(self, app_id: str, room_id: str, file_id: str,
                 keep: int | None = None):
        return sync_store.compact(app_id, room_id, file_id, keep)


def apply(ctx, config):
    return SyncHub(ctx)
