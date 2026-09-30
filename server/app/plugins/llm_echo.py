"""
插件：llm-echo（函数插件 / Provider）

模拟 LLM Provider：
- 第一次调用返回 tool_call（让 agent-loop 执行工具）
- 后续调用返回 echo 文本

对应 Cordis 的 packages/llm/llm-deepseek/src/index.ts。
接入真实模型时，照此文件新增 llm-xxx 插件即可，内核零改动。
"""

name = 'llm-echo'
inject = ['llm']


class EchoAdapter:
    """Echo Provider —— 模拟 LLM 返回"""

    def __init__(self, prefix='[ECHO]', model_name='echo-model'):
        self.prefix = prefix
        self.model_name = model_name
        self._call_count = 0

    def stream(self, messages, model=None, **kwargs):
        self._call_count += 1

        # 第一次调用：模拟返回 tool_call
        if self._call_count == 1:
            yield {
                'type': 'tool_call',
                'tool': 'bash',
                'args': {'command': 'ls'},
            }
            return

        # 后续调用：返回 echo 文本
        last_msg = messages[-1]['content'] if messages else 'hello'
        # 如果最后一条是 tool_result，生成总结性回复
        if messages and messages[-1].get('role') == 'tool':
            tool_output = messages[-1]['content']
            lines = tool_output.strip().split('\n')
            summary = ', '.join(lines[:5])
            yield {'type': 'text', 'content': f'{self.prefix} 目录包含: {summary}'}
        else:
            yield {'type': 'text', 'content': f'{self.prefix} {last_msg}'}


def apply(ctx, config):
    """函数插件入口：注册 EchoAdapter 到 ctx.llm"""
    prefix = config.get('echo_prefix', '[ECHO]')
    model_name = config.get('model_name', 'echo-model')

    adapter = EchoAdapter(prefix=prefix, model_name=model_name)

    ctx.llm.register_adapter(
        [config.get('provider', 'echo')],
        adapter,
    )
