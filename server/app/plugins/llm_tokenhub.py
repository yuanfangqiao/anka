"""
插件：llm-tokenhub（函数插件 / Provider）

接入腾讯云 TokenHub（OpenAI 兼容）真实模型：
- 13 个模型 ID 全部注册为前缀（覆盖 LlmRuntime 的 startswith 匹配）
- API Key 每次请求时经 settings.get_api_key() 解析（轮换后下一请求即时生效）
- httpx 同步流式 POST，逐 chunk 解析 SSE yield，不物化整条流

对应 Cordis 的 packages/llm/llm-deepseek/src/index.ts。
"""

import json
import logging

import httpx

from app import settings

log = logging.getLogger('agentos.llm_tokenhub')

name = 'llm-tokenhub'
inject = ['llm']

# TokenHub 错误码 → 可读提示
_ERROR_HINTS = {
    '401': 'API Key 或 URL 配置错误（401）',
    '429': 'TPM 限流，稍后重试（429）',
    '20033': '模型名错误（20033），请检查模型 ID',
    '20059': '输入超长（20059），请精简上下文',
    '20097': '月度额度已耗尽（20097）',
}


def _hint_for(status_code: int, body: str) -> str:
    for code, hint in _ERROR_HINTS.items():
        if code in body or str(status_code) == code:
            return hint
    return f'TokenHub 请求失败（HTTP {status_code}）: {body[:200]}'


class TokenHubAdapter:
    """OpenAI 兼容流式 Provider"""

    def __init__(self):
        base = settings.TOKENHUB_BASE_URL.rstrip('/')
        self.endpoint = (
            base if base.endswith('/chat/completions')
            else f'{base}/chat/completions'
        )

    def _build_payload(self, messages, model, kwargs):
        payload = {
            'model': model,
            'messages': messages,
            'stream': True,
        }
        if kwargs.get('tools'):
            payload['tools'] = kwargs['tools']
        if kwargs.get('temperature') is not None:
            payload['temperature'] = kwargs['temperature']
        return payload

    def stream(self, messages, model=None, **kwargs):
        api_key = settings.get_api_key()
        if not api_key:
            yield {'type': 'text',
                   'content': '[llm-tokenhub] 未配置 API Key，请在设置页填入 sk-tp- 开头的密钥'}
            return

        payload = self._build_payload(messages, model, kwargs)
        headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
        }

        try:
            with httpx.Client(timeout=httpx.Timeout(120.0, connect=10.0)) as client:
                with client.stream('POST', self.endpoint,
                                   json=payload, headers=headers) as resp:
                    if resp.status_code != 200:
                        yield {'type': 'text',
                               'content': _hint_for(resp.status_code, resp.text)}
                        return
                    yield from self._parse_sse(resp)
        except httpx.HTTPError as e:
            yield {'type': 'text', 'content': f'TokenHub 网络错误: {e}'}

    def _parse_sse(self, resp):
        """逐行解析 SSE，text 即时 yield，tool_call 在收尾时聚合 yield。"""
        tool_acc = {}   # index -> {id, name, args}
        finish = None

        for raw in resp.iter_lines():
            line = raw.strip()
            if not line or not line.startswith('data:'):
                continue
            data = line[5:].strip()
            if data == '[DONE]':
                break
            try:
                chunk = json.loads(data)
            except json.JSONDecodeError:
                continue

            for choice in chunk.get('choices', []):
                delta = choice.get('delta') or {}
                finish = choice.get('finish_reason') or finish

                content = delta.get('content')
                if content:
                    yield {'type': 'text', 'content': content}

                for tc in delta.get('tool_calls') or []:
                    idx = tc.get('index', 0)
                    acc = tool_acc.setdefault(
                        idx, {'id': None, 'name': None, 'args': ''})
                    if tc.get('id'):
                        acc['id'] = tc['id']
                    fn = tc.get('function') or {}
                    if fn.get('name'):
                        acc['name'] = fn['name']
                    if fn.get('arguments'):
                        acc['args'] += fn['arguments']

        # 工具调用在流结束时聚合发出（arguments 分片完整后）
        for acc in tool_acc.values():
            name = acc['name'] or 'unknown'
            try:
                args = json.loads(acc['args'] or '{}')
            except json.JSONDecodeError:
                args = {'_raw': acc['args']}
            yield {'type': 'tool_call', 'tool': name, 'args': args,
                   'id': acc['id']}


def apply(ctx, config):
    """函数插件入口：把 13 个模型 ID 注册为前缀"""
    adapter = TokenHubAdapter()
    ctx.llm.register_adapter(
        [m['id'] for m in settings.TOKENHUB_MODELS],
        adapter,
    )
