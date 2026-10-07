"""
插件：session-log（函数插件 / 日志）

append-only 会话事件日志（DSH 式「模型可见即已记录」）：
- 挂 llm/stream（waterfall）记录每次发给模型的完整 messages（权威快照）与流式响应
- 挂 tools/post-execute（emit）记录工具调用与结果
- 按会话分文件（server/data/sessions/<id>.jsonl），只追加不修改

会话绑定：chat worker 在起跑前调用 bind(session_id)，同一线程内所有
LLM 调用（含多轮 function calling）都记到同一会话；未绑定时兜底新建。

对外提供会话管理能力（供 /api/sessions 与前端侧栏使用）：
list_sessions / session_messages / delete_session / derive_messages。

对应 Cordis 的 packages/session/src/index.ts（ctx.sessions + deriveMessages）。
"""

import json
import logging
import threading
import time
import uuid

from app import settings

log = logging.getLogger('agentos.session_log')

name = 'session-log'
inject = []

_SESSIONS_DIR = settings.DATA_DIR / 'sessions'
_tls = threading.local()


# ─── 会话上下文（线程本地）─────────────────────────────

def _current_session() -> str | None:
    return getattr(_tls, 'session_id', None)


def new_session_id() -> str:
    return uuid.uuid4().hex


def bind(session_id: str) -> None:
    """把当前工作线程绑定到指定会话（chat worker 调用）。"""
    _tls.session_id = session_id


def unbind() -> None:
    _tls.session_id = None


def _append(session_id: str, event: dict) -> None:
    _SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    event['ts'] = time.time()
    line = json.dumps(event, ensure_ascii=False)
    with (_SESSIONS_DIR / f'{session_id}.jsonl').open('a', encoding='utf-8') as f:
        f.write(line + '\n')


# ─── 事件挂钩 ────────────────────────────────────────

def _record_stream(options, next_fn):
    """llm/stream waterfall：记请求（权威 messages 快照）+ 流式响应"""
    messages = options.get('messages', [])
    model = options.get('model', '?')

    session = _current_session()
    if session is None:
        session = new_session_id()
        _tls.session_id = session
        _append(session, {'event': 'session/start', 'model': model})

    _append(session, {
        'event': 'request',
        'model': model,
        'messages': messages,       # 模型可见即已记录（权威快照）
    })

    acc = {'text': '', 'tool_calls': []}

    def _tap(source):
        for chunk in source:
            ctype = chunk.get('type')
            if ctype == 'text':
                acc['text'] += chunk.get('content', '')
            elif ctype == 'tool_call':
                acc['tool_calls'].append({
                    'tool': chunk.get('tool'),
                    'args': chunk.get('args'),
                    'id': chunk.get('id'),
                })
            yield chunk

    yield from _tap(next_fn())

    _append(session, {
        'event': 'response',
        'text': acc['text'],
        'tool_calls': acc['tool_calls'],
    })


def _record_tool(exec_ctx, result):
    """tools/post-execute（emit）：记工具调用与结果"""
    session = _current_session()
    if session is None:
        return
    _append(session, {
        'event': 'tool_result',
        'tool': exec_ctx.get('tool_name'),
        'args': exec_ctx.get('args'),
        'result': str(result),
    })


# ─── 读取与投影 ──────────────────────────────────────

def _read_events(session_id: str) -> list:
    path = _SESSIONS_DIR / f'{session_id}.jsonl'
    if not path.is_file():
        return []
    events = []
    for line in path.read_text(encoding='utf-8').splitlines():
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return events


def derive_messages(session_id: str) -> list:
    """从会话日志投影模型历史（权威源）。

    取最后一条 request 的完整 messages，再补上其后的最终 assistant 回复
    （文本或收尾 tool_calls），得到可直接续聊的 OpenAI 格式历史。
    """
    messages: list = []
    pending = None
    for ev in _read_events(session_id):
        e = ev.get('event')
        if e == 'request':
            messages = ev.get('messages', [])
            pending = None
        elif e == 'response':
            pending = ev

    if not pending:
        return messages

    text = pending.get('text') or ''
    tool_calls = pending.get('tool_calls') or []
    if tool_calls:
        calls = [{
            'id': tc.get('id') or f'call_{i}',
            'type': 'function',
            'function': {
                'name': tc.get('tool'),
                'arguments': json.dumps(tc.get('args') or {}, ensure_ascii=False),
            },
        } for i, tc in enumerate(tool_calls)]
        return messages + [{'role': 'assistant', 'content': text or None,
                            'tool_calls': calls}]
    if text:
        return messages + [{'role': 'assistant', 'content': text}]
    return messages


def _split_content(content) -> tuple[str, str | None]:
    """OpenAI content 兼容拆解：纯文本原样返回；vision 数组拆出文本与首图。"""
    if isinstance(content, list):
        text = ' '.join(str(p.get('text', ''))
                        for p in content
                        if isinstance(p, dict) and p.get('type') == 'text').strip()
        image = next((p.get('image_url', {}).get('url')
                      for p in content
                      if isinstance(p, dict) and p.get('type') == 'image_url'), None)
        return text, image
    return (content or ''), None


def _project(messages: list) -> list:
    """把 OpenAI 格式 messages 投影成前端可渲染的气泡（user/assistant + 工具卡）。"""
    ui: list = []
    pending_tools: dict = {}
    for m in messages:
        role = m.get('role')
        if role == 'user':
            text, image = _split_content(m.get('content'))
            entry = {'role': 'user', 'text': text}
            if image:
                entry['image'] = image
            ui.append(entry)
        elif role == 'assistant':
            entry = {'role': 'assistant', 'text': m.get('content') or '', 'tools': []}
            for tc in m.get('tool_calls') or []:
                fn = tc.get('function') or {}
                try:
                    args = json.loads(fn.get('arguments') or '{}')
                except json.JSONDecodeError:
                    args = {}
                card = {'name': fn.get('name'), 'args': args, 'result': '执行中…'}
                entry['tools'].append(card)
                if tc.get('id'):
                    pending_tools[tc['id']] = card
            ui.append(entry)
        elif role == 'tool':
            card = pending_tools.get(m.get('tool_call_id'))
            if card is not None:
                card['result'] = m.get('content') or ''
    return ui


def session_messages(session_id: str) -> list:
    """会话的 UI 气泡列表（切换历史会话时加载）。"""
    return _project(derive_messages(session_id))


def _title_of(events: list) -> str:
    for ev in events:
        if ev.get('event') != 'request':
            continue
        for m in ev.get('messages', []):
            if m.get('role') == 'user' and m.get('content'):
                text, _ = _split_content(m['content'])
                text = text.strip().replace('\n', ' ')
                if text:
                    return text[:24] + ('…' if len(text) > 24 else '')
    return '新会话'


def list_sessions() -> list:
    """全部会话摘要，按最近更新倒序。"""
    if not _SESSIONS_DIR.is_dir():
        return []
    result = []
    for path in _SESSIONS_DIR.glob('*.jsonl'):
        events = _read_events(path.stem)
        if not events:
            continue
        result.append({
            'id': path.stem,
            'title': _title_of(events),
            'updated_at': events[-1].get('ts', 0),
            'count': sum(1 for e in events if e.get('event') == 'response'),
        })
    result.sort(key=lambda s: s['updated_at'], reverse=True)
    return result


def delete_session(session_id: str) -> bool:
    path = _SESSIONS_DIR / f'{session_id}.jsonl'
    if path.is_file():
        path.unlink()
        return True
    return False


def apply(ctx, config):
    ctx.events.on('llm/stream', _record_stream)
    ctx.events.on('tools/post-execute', _record_tool)
