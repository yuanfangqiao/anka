"""Isolated integration provider: the production harness, transport and page run unchanged."""
import base64
import json
import socket
from contextlib import asynccontextmanager

import uvicorn
from app import auth, deps, settings
from app.main import app

auth.save_users({
    'web-use-qa': {'password': auth.hash_password('web-use-fixture')},
    'other-qa': {'password': auth.hash_password('web-use-fixture')},
})

STEPS = ('web_list_apps', 'web_open_app', 'web_observe', 'web_fill', 'web_observe',
         'web_scroll', 'web_observe', 'web_tap', 'web_observe', 'web_tap', 'web_tap', 'web_observe')


class FixtureModel:
    def stream(self, messages, model=None, tools=None, **_):
        names = {t['function']['name'] for t in tools or []}
        if 'web_observe' not in names:
            yield {'type': 'text', 'content': '普通对话未暴露网页工具'}
            return
        assert names == set(STEPS)
        start = max(i for i, m in enumerate(messages) if m['role'] == 'user'
                    and isinstance(m['content'], str))
        results = [json.loads(m['content']) for m in messages[start:] if m['role'] == 'tool']
        n = len(results)
        if n >= len(STEPS):
            assert '1/1' in results[-1]['text']
            yield {'type': 'text', 'content': '网页操作验收完成'}
            return
        args = {}
        if n == 1:
            assert any(a['appId'] == 'web-use-demo' for a in results[-1]['apps'])
            args = {'appId': 'web-use-demo'}
        if n == 2:
            assert results[-1]['ready'] and results[-1]['appId'] == 'web-use-demo'
        if n == 3:
            assert not any(e['label'] == '私密字段' for e in results[-1]['elements'])
            control = next(e for e in results[-1]['elements'] if e.get('editable'))
            args = {'observationId': results[-1]['observationId'], 'target': control['id'], 'text': '海边'}
        if n == 4:
            assert results[-1].get('performed') == 'fill', results[-1]
        if n == 5:
            scroller = next(e for e in results[-1]['elements'] if e['label'] == '关卡列表')
            args = {'observationId': results[-1]['observationId'], 'target': scroller['id'], 'dy': 205}
        if n == 6:
            assert results[-1]['dy'] > 130
        if n == 7:
            button = next(e for e in results[-1]['elements'] if e['label'] == '打开海边')
            args = {'observationId': results[-1]['observationId'], 'target': button['id']}
        if n == 8:
            assert results[-1]['performed'] == 'tap'
            args = {'image': True, 'scope': 'canvas'}
        if n == 9:
            assert results[-1]['image']['source'] == 'canvas'
            visual = messages[-1]['content'][-1]['image_url']['url']
            assert base64.b64decode(visual.split(',', 1)[1]).startswith(b'\xff\xd8\xff')
        if n in (9, 10):
            args = {'observationId': results[8]['observationId'], 'x': .75, 'y': .40}
        if n == 10:
            assert results[-1]['performed'] == 'tap'
        if n == 11:
            assert results[-1]['ok'] is False and '过期' in results[-1]['error']
        yield {'type': 'tool_call', 'tool': STEPS[n], 'args': args}


original = app.router.lifespan_context


@asynccontextmanager
async def lifespan(instance):
    async with original(instance):
        deps.manager.ctx.get('llm').register_adapter(
            ['echo', *(m['id'] for m in settings.TOKENHUB_MODELS)], FixtureModel())
        yield


app.router.lifespan_context = lifespan
sock = socket.socket()
sock.bind(('127.0.0.1', 0))
print(f'WEB_USE_PORT={sock.getsockname()[1]}', flush=True)
uvicorn.Server(uvicorn.Config(app, log_level='warning')).run(sockets=[sock])
