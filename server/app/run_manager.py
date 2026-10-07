"""RunManager —— 对话任务的服务端常驻运行器（M17）。

借鉴 reference/pi 的 durable harness：run 的生命周期属于服务端，
而非某次 HTTP 连接——
- POST /api/chat 只负责「启动」，立即返回 run_id，worker 线程后台执行
- 客户端经 GET /api/runs/{id}/stream?after=N 订阅：先重放缓冲事件，再续传现场
- 客户端断连（切后台/切应用/刷新页面）不取消 run；只有显式 stop 才终止
- 页面刷新后凭 GET /api/runs 找回活动 run，重放全量事件即可重建现场

事件带单调递增 seq，客户端记录游标，断线重连用 after=cursor 无重无漏续传。
"""

import queue
import threading
import time
import uuid

DONE_TTL = 1800        # 完成的 run 保留 30 分钟供重放/对账
MAX_BUFFER = 5000      # 单 run 事件缓冲上限（防爆内存；正常任务远不及）


class Run:
    """一次对话执行任务：事件缓冲 + 订阅者分发 + 取消令牌。"""

    def __init__(self, session_id: str, message: str, model: str):
        self.id = uuid.uuid4().hex[:12]
        self.session_id = session_id
        self.preview = message.strip().replace('\n', ' ')[:40]
        self.model = model
        self.created_at = time.time()
        self.events: list[dict] = []
        self.done = False
        self.finished_at: float | None = None
        self.cancel = threading.Event()
        self._subs: list[queue.Queue] = []
        self._lock = threading.Lock()

    def emit(self, payload: dict) -> None:
        """worker 线程调用：缓冲 + 广播给全部订阅者。"""
        with self._lock:
            if len(self.events) >= MAX_BUFFER:
                return
            ev = dict(payload)
            ev['seq'] = len(self.events) + 1
            if ev.get('type') == 'done':
                self.done = True
                self.finished_at = time.time()
            self.events.append(ev)
            subs = list(self._subs)
        for q in subs:
            q.put(ev)

    def subscribe(self, after: int = 0):
        """原子地返回 (重放事件, 现场队列)。

        锁内同时取快照与登记订阅，保证 after 之后无重叠、无丢失；
        run 已结束则不登记订阅（返回 None），重放里已含 done 事件。
        """
        q: queue.Queue = queue.Queue()
        with self._lock:
            replay = [e for e in self.events if e['seq'] > after]
            if self.done:
                return replay, None
            self._subs.append(q)
        return replay, q

    def unsubscribe(self, q: queue.Queue) -> None:
        with self._lock:
            if q in self._subs:
                self._subs.remove(q)

    def summary(self) -> dict:
        return {
            'id': self.id,
            'session_id': self.session_id,
            'preview': self.preview,
            'model': self.model,
            'active': not self.done,
            'created_at': self.created_at,
        }


class RunManager:
    def __init__(self):
        self._runs: dict[str, Run] = {}
        self._lock = threading.Lock()

    def create(self, session_id: str, message: str, model: str) -> Run:
        run = Run(session_id, message, model)
        with self._lock:
            self._gc_locked()
            self._runs[run.id] = run
        return run

    def get(self, run_id: str) -> Run | None:
        with self._lock:
            return self._runs.get(run_id)

    def list(self) -> list[dict]:
        with self._lock:
            self._gc_locked()
            runs = sorted(self._runs.values(),
                          key=lambda r: r.created_at, reverse=True)
            return [r.summary() for r in runs]

    def _gc_locked(self) -> None:
        now = time.time()
        expired = [rid for rid, r in self._runs.items()
                   if r.done and r.finished_at and now - r.finished_at > DONE_TTL]
        for rid in expired:
            del self._runs[rid]


manager = RunManager()
