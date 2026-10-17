"""Ledger —— 插件安装事件的唯一事实来源。

append-only JSONL + 快照：
- 每个事件一行 JSON，`O_APPEND` 写入并 fsync，崩溃最多丢最后一行；
- 损坏行跳过并记入 `problems`，不阻塞启动；
- 投影是纯函数：`installed` 置位、`uninstalled` 移除、`failed` 标记失败；
- 超过阈值时把当前投影写成快照，并把事件文件轮转为 `ledger.jsonl.<ts>.bak`
  （保留审计痕迹），随后从空文件继续追加。

本模块不认识 PluginManager / FolderManifest，只处理字符串 id 与事件。
"""

import json
import logging
import os
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from . import settings

log = logging.getLogger('agentos.ledger')

EVENTS = ('installed', 'uninstalled', 'failed', 'approved', 'legacy_import')
_STATE_BY_EVENT = {
    'installed': 'installed',
    'legacy_import': 'installed',
    'failed': 'failed',
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


@dataclass(frozen=True)
class LedgerEvent:
    event: str
    id: str
    version: str = ''
    kind: str = ''
    source: str = ''
    detail: dict = field(default_factory=dict)
    v: int = 1
    ts: str = ''

    def to_dict(self) -> dict:
        return {
            'v': self.v,
            'ts': self.ts or _now(),
            'event': self.event,
            'id': self.id,
            'version': self.version,
            'kind': self.kind,
            'source': self.source,
            'detail': self.detail,
        }

    @classmethod
    def from_dict(cls, data: dict) -> 'LedgerEvent | None':
        if not isinstance(data, dict):
            return None
        event = data.get('event')
        pid = data.get('id')
        if event not in EVENTS or not isinstance(pid, str) or not pid:
            return None
        detail = data.get('detail')
        return cls(
            event=event, id=pid,
            version=str(data.get('version') or ''),
            kind=str(data.get('kind') or ''),
            source=str(data.get('source') or ''),
            detail=detail if isinstance(detail, dict) else {},
            v=int(data.get('v') or 1),
            ts=str(data.get('ts') or ''),
        )


class Ledger:
    def __init__(self, path: Path | None = None,
                 snapshot_path: Path | None = None,
                 compact_every: int | None = None) -> None:
        self.path = Path(path or settings.LEDGER_FILE)
        self.snapshot_path = Path(snapshot_path or settings.LEDGER_SNAPSHOT)
        self.compact_every = int(
            compact_every if compact_every is not None
            else settings.LEDGER_COMPACT_EVERY)
        self.problems: list[str] = []
        self._lock = threading.RLock()
        self._state: dict[str, dict] | None = None
        self._pending = 0          # 自上次快照以来追加的事件数

    # ─── 读取 ──────────────────────────────────

    def _ensure(self) -> dict[str, dict]:
        with self._lock:
            if self._state is None:
                self._state = self._replay()
            return self._state

    def _replay(self) -> dict[str, dict]:
        state: dict[str, dict] = {}
        self.problems = []
        snap = self._read_snapshot()
        if snap:
            state.update(snap)
        if not self.path.is_file():
            return state
        try:
            lines = self.path.read_text(encoding='utf-8').splitlines()
        except OSError as e:
            self.problems.append(f'ledger 读取失败: {e}')
            log.error('ledger 读取失败: %s', e)
            return state
        for no, line in enumerate(lines, 1):
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
            except Exception:
                self.problems.append(f'第 {no} 行不是合法 JSON，已跳过')
                continue
            ev = LedgerEvent.from_dict(data)
            if ev is None:
                self.problems.append(f'第 {no} 行事件非法，已跳过')
                continue
            self._apply(state, ev)
        if self.problems:
            log.warning('ledger 有 %d 处问题: %s', len(self.problems),
                        '；'.join(self.problems[:5]))
        return state

    def _read_snapshot(self) -> dict[str, dict]:
        if not self.snapshot_path.is_file():
            return {}
        try:
            data = json.loads(self.snapshot_path.read_text(encoding='utf-8'))
            state = data.get('state') or {}
            return state if isinstance(state, dict) else {}
        except Exception as e:
            self.problems.append(f'快照不可读，按空投影继续: {e}')
            log.error('ledger 快照不可读: %s', e)
            return {}

    @staticmethod
    def _apply(state: dict[str, dict], ev: LedgerEvent) -> None:
        if ev.event == 'uninstalled':
            state.pop(ev.id, None)
            return
        new_state = _STATE_BY_EVENT.get(ev.event)
        if new_state is None:
            return
        prev = state.get(ev.id) or {}
        state[ev.id] = {
            'state': new_state,
            'version': ev.version or prev.get('version', ''),
            'kind': ev.kind or prev.get('kind', ''),
            'source': ev.source or prev.get('source', ''),
            'ts': ev.ts or prev.get('ts', ''),
        }

    # ─── 投影 ──────────────────────────────────

    def project(self) -> dict[str, str]:
        return {pid: rec.get('state', '')
                for pid, rec in self._ensure().items()}

    def records(self) -> dict[str, dict]:
        return {pid: dict(rec) for pid, rec in self._ensure().items()}

    def installed_ids(self) -> list[str]:
        return sorted(pid for pid, st in self.project().items()
                      if st == 'installed')

    def state_of(self, plugin_id: str) -> str | None:
        rec = self._ensure().get(plugin_id)
        return rec.get('state') if rec else None

    # ─── 写入 ──────────────────────────────────

    def append(self, event: LedgerEvent) -> None:
        with self._lock:
            state = self._ensure()
            self.path.parent.mkdir(parents=True, exist_ok=True)
            line = json.dumps(event.to_dict(), ensure_ascii=False)
            fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
            try:
                os.write(fd, (line + '\n').encode('utf-8'))
                os.fsync(fd)
            finally:
                os.close(fd)
            self._apply(state, event)
            self._pending += 1
            log.info('ledger %s %s', event.event, event.id)
        self.compact()

    def mark(self, event: str, plugin_id: str, *, version: str = '',
             kind: str = '', source: str = '', detail: dict | None = None) -> None:
        self.append(LedgerEvent(event=event, id=plugin_id, version=version,
                                kind=kind, source=source, detail=detail or {}))

    # ─── 压缩 ──────────────────────────────────

    def compact(self, force: bool = False) -> bool:
        with self._lock:
            if not force and self._pending < self.compact_every:
                return False
            state = self._ensure()
            payload = {'v': 1, 'ts': _now(),
                       'state': {k: dict(v) for k, v in state.items()}}
            self.snapshot_path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.snapshot_path.with_suffix('.tmp')
            try:
                tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2),
                               encoding='utf-8')
                os.replace(tmp, self.snapshot_path)
            except OSError as e:
                log.error('ledger 快照写入失败: %s', e)
                return False
            if self.path.is_file() and self.path.stat().st_size > 0:
                bak = self.path.with_name(f'{self.path.name}.{int(time.time())}.bak')
                try:
                    os.replace(self.path, bak)
                except OSError as e:
                    log.warning('ledger 轮转失败（保留原文件）: %s', e)
                    return False
            self._pending = 0
            log.info('ledger 已压缩: %d 条投影 -> %s', len(state), self.snapshot_path)
            return True

    # ─── 迁移 ──────────────────────────────────

    def migrate_from_json(self, path: Path | None = None) -> int:
        """installed.json 一次性导入。幂等：ledger 已有内容时直接返回 0。"""
        src = Path(path or settings.INSTALLED_FILE)
        with self._lock:
            if self.path.is_file() and self.path.stat().st_size > 0:
                return 0
            if src.is_file():
                try:
                    ids = json.loads(src.read_text(encoding='utf-8'))
                except Exception as e:
                    log.error('installed.json 解析失败，跳过迁移: %s', e)
                    return 0
                if not isinstance(ids, list):
                    log.error('installed.json 不是数组，跳过迁移')
                    return 0
                ids = [str(i) for i in ids if isinstance(i, str) and i]
                source = 'legacy'
            else:
                ids = list(settings.DEFAULT_INSTALLED)
                source = 'default'
            if not ids:
                return 0
            for pid in ids:
                self.append(LedgerEvent(event='legacy_import', id=pid,
                                        source=source,
                                        detail={'from': str(src) if source == 'legacy'
                                                else 'DEFAULT_INSTALLED'}))
            if src.is_file():
                try:
                    src.rename(src.with_suffix('.json.bak'))
                except OSError as e:
                    log.warning('installed.json 改名失败: %s', e)
            log.info('ledger 迁移完成: %d 条（source=%s）', len(ids), source)
            return len(ids)
