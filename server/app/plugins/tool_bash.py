"""
插件：tool-bash（函数插件 / Consumer）

注册 bash 工具到 ctx.tools。
只知道 ctx.tools，完全不知道 LLM 的存在 —— 解耦的具体体现。

对应 Cordis 的 packages/shell/tool-bash/src/index.ts。
"""

import subprocess

name = 'tool-bash'
inject = ['tools']


def _run_bash(args: dict) -> str:
    """执行 shell 命令并返回输出"""
    command = args.get('command', 'echo hello')
    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=10,
            cwd=None,
        )
        output = result.stdout.strip()
        if result.returncode != 0 and result.stderr:
            output += f'\n[stderr] {result.stderr.strip()}'
        return output if output else '(no output)'
    except subprocess.TimeoutExpired:
        return 'error: command timed out (10s)'
    except Exception as e:
        return f'error: {e}'


def apply(ctx, config):
    """注册 bash 工具"""
    ctx.tools.register({
        'name': 'bash',
        'description': 'Execute a shell command',
        'handler': _run_bash,
        'parameters': {
            'type': 'object',
            'properties': {
                'command': {
                    'type': 'string',
                    'description': '要执行的 shell 命令',
                },
            },
            'required': ['command'],
        },
    })
