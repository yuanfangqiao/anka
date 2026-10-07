"""
插件：sync-store（函数插件 / 存储访问层）

多端同步的 SQLite 访问层（M16）。三张表：
- sync_doc  ：每个「文件」(= 一块画布) 一条物化快照
- sync_log  ：op-log，房间+文件内 seq 单调递增（追帧 / 回放 / 冲突排查）
- sync_index：文件索引（§3.11 风险 5：不同步会导致换设备后文件列表对不上）

连接按线程本地持有 —— 内核跑在 worker 线程（见 api/chat.py 的
threading.Thread），而 SQLite 连接默认 check_same_thread=True 不可跨线程共享。
启用 WAL + busy_timeout，避免并发写「database is locked」。
"""

import json
import logging
import sqlite3
import threading
import time

from app import settings

log = logging.getLogger('agentos.sync_store')

name = 'sync-store'
inject = []

_tls = threading.local()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS sync_doc (
  app_id     TEXT NOT NULL,
  room_id    TEXT NOT NULL,
  file_id    TEXT NOT NULL,
  rev        INTEGER NOT NULL DEFAULT 0,
  snapshot   TEXT NOT NULL DEFAULT '{}',
  updated_at REAL NOT NULL,
  PRIMARY KEY (app_id, room_id, file_id)
);
CREATE TABLE IF NOT EXISTS sync_log (
  app_id    TEXT NOT NULL,
  room_id   TEXT NOT NULL,
  file_id   TEXT NOT NULL,
  seq       INTEGER NOT NULL,
  client_id TEXT,
  diff      TEXT NOT NULL,
  ts        REAL NOT NULL,
  PRIMARY KEY (app_id, room_id, file_id, seq)
);
CREATE TABLE IF NOT EXISTS sync_index (
  app_id     TEXT NOT NULL,
  room_id    TEXT NOT NULL,
  rev        INTEGER NOT NULL DEFAULT 0,
  payload    TEXT NOT NULL DEFAULT '{}',
  updated_at REAL NOT NULL,
  PRIMARY KEY (app_id, room_id)
);
CREATE INDEX IF NOT EXISTS idx_log_lookup
  ON sync_log(app_id, room_id, file_id, seq);
"""


def _conn() -> sqlite3.Connection:
    """线程本地连接（SQLite 连接不可跨线程共享）。"""
    c = getattr(_tls, 'conn', None)
    if c is None:
        settings.DATA_DIR.mkdir(parents=True, exist_ok=True)
        c = sqlite3.connect(
            str(settings.SYNC_DB), timeout=15.0, isolation_level=None,
        )
        c.row_factory = sqlite3.Row
        c.execute('PRAGMA journal_mode=WAL')
        c.execute('PRAGMA busy_timeout=15000')
        c.executescript(_SCHEMA)
        _tls.conn = c
    return c


def init_db() -> None:
    """幂等建库建表（启动时调用）。"""
    _conn()


def apply(ctx, config) -> None:
    """插件入口：确保库表就绪。"""
    init_db()


# ─── 文档快照 ─────────────────────────────────────────

def get_doc(app_id: str, room_id: str, file_id: str) -> tuple[int, dict]:
    row = _conn().execute(
        'SELECT rev, snapshot FROM sync_doc '
        'WHERE app_id=? AND room_id=? AND file_id=?',
        (app_id, room_id, file_id)).fetchone()
    if row is None:
        return 0, {}
    try:
        return int(row['rev']), json.loads(row['snapshot'])
    except (json.JSONDecodeError, TypeError):
        log.error('快照解析失败 %s/%s/%s', app_id, room_id, file_id)
        return 0, {}


def save_doc(app_id: str, room_id: str, file_id: str,
            rev: int, snapshot: dict) -> None:
    _conn().execute(
        'INSERT INTO sync_doc (app_id, room_id, file_id, rev, snapshot, updated_at) '
        'VALUES (?,?,?,?,?,?) '
        'ON CONFLICT(app_id, room_id, file_id) DO UPDATE SET '
        '  rev=excluded.rev, snapshot=excluded.snapshot, updated_at=excluded.updated_at',
        (app_id, room_id, file_id, int(rev),
         json.dumps(snapshot or {}, ensure_ascii=False), time.time()))


# ─── op-log（权威增量）────────────────────────────────

def max_seq(app_id: str, room_id: str, file_id: str) -> int:
    row = _conn().execute(
        'SELECT COALESCE(MAX(seq),0) AS m FROM sync_log '
        'WHERE app_id=? AND room_id=? AND file_id=?',
        (app_id, room_id, file_id)).fetchone()
    return int(row['m'])


def append_op(app_id: str, room_id: str, file_id: str,
            diff: dict, client_id: str | None = None) -> int:
    """追加一条 op，返回分配到的 seq（房间+文件内单调递增）。"""
    c = _conn()
    c.execute('BEGIN IMMEDIATE')
    try:
        row = c.execute(
            'SELECT COALESCE(MAX(seq),0)+1 AS next FROM sync_log '
            'WHERE app_id=? AND room_id=? AND file_id=?',
            (app_id, room_id, file_id)).fetchone()
        seq = int(row['next'])
        c.execute(
            'INSERT INTO sync_log (app_id, room_id, file_id, seq, client_id, diff, ts) '
            'VALUES (?,?,?,?,?,?,?)',
            (app_id, room_id, file_id, seq, client_id,
             json.dumps(diff or {}, ensure_ascii=False), time.time()))
        c.execute('COMMIT')
    except Exception:
        c.execute('ROLLBACK')
        raise
    return seq


def ops_since(app_id: str, room_id: str, file_id: str,
             since: int = 0) -> list[dict]:
    rows = _conn().execute(
        'SELECT seq, client_id, diff, ts FROM sync_log '
        'WHERE app_id=? AND room_id=? AND file_id=? AND seq>? ORDER BY seq',
        (app_id, room_id, file_id, int(since))).fetchall()
    out = []
    for r in rows:
        try:
            out.append({'seq': int(r['seq']), 'client_id': r['client_id'],
                        'ts': r['ts'], 'diff': json.loads(r['diff'])})
        except (json.JSONDecodeError, TypeError):
            continue
    return out


def compact(app_id: str, room_id: str, file_id: str,
          keep: int | None = None) -> int:
    """op-log 压缩进快照，只保留最近 keep 条。返回删除条数。"""
    if keep is None:
        keep = settings.SYNC_LOG_KEEP
    c = _conn()
    c.execute('BEGIN IMMEDIATE')
    try:
        total = max_seq(app_id, room_id, file_id)
        cut = total - keep
        if cut <= 0:
            c.execute('COMMIT')
            return 0
        c.execute(
            'DELETE FROM sync_log '
            'WHERE app_id=? AND room_id=? AND file_id=? AND seq<=?',
            (app_id, room_id, file_id, cut))
        c.execute('COMMIT')
    except Exception:
        c.execute('ROLLBACK')
        raise
    return cut
