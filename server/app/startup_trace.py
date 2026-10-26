"""Monotonic startup timings; no plugin business logic or persistent state."""
import logging
from contextlib import contextmanager
from time import perf_counter

log = logging.getLogger('agentos.startup')


@contextmanager
def phase(label: str):
    started = perf_counter()
    log.info('[startup] 开始 %s', label)
    try:
        yield
    except BaseException:
        log.exception('[startup] 失败 %s，耗时=%.3fs',
                      label, perf_counter() - started)
        raise
    else:
        log.info('[startup] 完成 %s，耗时=%.3fs',
                 label, perf_counter() - started)
