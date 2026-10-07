"""
插件：harness-guard（函数插件 / 守卫）

挂在 tools/pre-execute（serial = 单调守卫）：
- 一旦返回拦截原因，tools_runtime 立即中止执行，后续守卫/工具不再运行
- 可编辑边界：Agent 只能写 plugins/（app 插件），内核 / 护栏 / 日志 / 审批源码
  位于 server/app/ 之下，天然不在 APP_PLUGINS_DIR 内，Agent 经 fs_write 无法触及
- bash 危险命令黑名单

对应 Cordis 的 tools/pre-execute 策略守卫 + sandbox-policy。
"""

import re

from app.plugins._harness_support import resolve_plugin_path

name = 'harness-guard'
inject = []  # 纯监听守卫，无服务依赖

_ID_RE = re.compile(r'^[a-z0-9-]+$')

# 危险命令黑名单（不区分大小写）
_DANGEROUS = (
    r'\brm\s+-rf\s+/(\s|$)',   # rm -rf /
    r'\bmkfs\b',               # 格式化文件系统
    r'\bdd\b',                 # dd 裸写磁盘
    r'>\s*/dev/(sd|hd|nvme|zero|random)',  # 重定向写块设备
    r'\bshutdown\b', r'\breboot\b', r'\bhalt\b', r'\bpoweroff\b',
    r':\(\)\s*\{',             # fork bomb
    r'\bfind\b[^\n]*\s+-delete',  # find -delete（易误删）
)


def _is_dangerous(cmd: str) -> bool:
    low = cmd.lower()
    return any(re.search(p, low) for p in _DANGEROUS)


def apply(ctx, config):
    def gate(exec_ctx):
        tool = exec_ctx.get('tool_name')
        args = exec_ctx.get('args') or {}

        # 文件工具：路径必须收敛在 plugins/ 内（与 harness_tools 同一策略）
        if tool in ('fs_list', 'fs_read', 'fs_write'):
            rel = args.get('path', '')
            try:
                resolve_plugin_path(rel)
            except ValueError as e:
                return f'denied: {tool} {e}'
            return None

        # 插件生命周期工具：id 格式校验
        if tool in ('plugin_scaffold', 'plugin_verify',
                    'plugin_install', 'plugin_uninstall', 'plugin_reload'):
            pid = (args.get('id') or '').strip()
            if not _ID_RE.fullmatch(pid):
                return f'denied: {tool} id 非法（仅小写字母/数字/连字符）'
            return None

        # bash：危险命令黑名单
        if tool == 'bash':
            cmd = args.get('command', '')
            if _is_dangerous(cmd):
                return 'denied: bash 命中危险命令黑名单'
            return None

        return None

    ctx.events.on('tools/pre-execute', gate)
