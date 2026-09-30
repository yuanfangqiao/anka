"""
插件：llm-logger（函数插件 / waterfall 拦截）

通过 ctx.events.on('llm/stream', ...) 拦截每次 LLM 调用，记录日志。

演示 waterfall 洋葱模型：
  前置（记请求）→ next() 委派 → 后置（记耗时）

卸载时 listener 自动被 fiber teardown 摘除。
"""

import logging
import time

log = logging.getLogger('agentos.llm_logger')

name = 'llm-logger'
inject = ['llm']


def apply(ctx, config):
    """挂 waterfall listener 到 llm/stream"""

    def log_stream(options, next_fn):
        # ── 前置 ──
        model = options.get('model', '?')
        msg_count = len(options.get('messages', []))
        log.info('>>> stream: model=%s, messages=%s', model, msg_count)
        start = time.time()

        # ── 委派（必须调 next_fn，否则整条链断在这里）──
        stream = next_fn()

        # ── 后置 ──
        elapsed = time.time() - start
        chunks = list(stream)
        log.info('<<< stream done: %s chunks, %.3fs', len(chunks), elapsed)

        return iter(chunks)

    ctx.events.on('llm/stream', log_stream)
