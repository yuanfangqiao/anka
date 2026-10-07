"""
插件：harness-tools（函数插件 / Consumer）

给 Agent 提供「自我插件开发」工具集（M14，参照 DeepSeek Harness 的 tool-cordis）：
  fs_list / fs_read / fs_write          读/写 plugins/ 目录（写前备份）
  plugin_scaffold                       脚手架生成 plugin.json + server/main.py + web/index.js
  plugin_verify                         语法 + manifest + 隔离试载（子进程 import + apply 冒烟）
  plugin_install / plugin_uninstall     经 PluginManager 装卸
  plugin_reload                         无重启重载（见 plugin_manager.reload_plugin）
  plugin_list                           列出已安装插件

安全模型（与 harness_guard 共享同一沙箱策略）：
- resolve_plugin_path 把一切相对路径收敛到 settings.APP_PLUGINS_DIR 内，拒绝越界
- 真正的「不可编辑边界」由 harness_guard 挂在 tools/pre-execute 强制（单调守卫）
- 本插件只做防御性校验，不持有白名单（白名单在护栏内，Agent 无法经 fs_write 改写）
"""

import json
import logging
import subprocess
import sys

from app import deps, settings
from app.plugins._harness_support import (
    _ID_RE,
    backup_plugin,
    plugin_id_of,
    resolve_plugin_path,
    scaffold_index_js,
    scaffold_main_py,
    verify_script,
)

log = logging.getLogger('agentos.harness_tools')

name = 'harness-tools'
inject = ['tools']


# ─── 文件工具 ───────────────────────────────────────────

def _fs_list(args):
    d = resolve_plugin_path(args.get('path', ''))
    if not d.is_dir():
        return f'error: 不是目录: {args.get("path", "")}'
    lines = []
    for c in sorted(d.iterdir()):
        lines.append(('dir ' if c.is_dir() else 'file ') + c.name)
    return '\n'.join(lines) if lines else '(空目录)'


def _fs_read(args):
    p = resolve_plugin_path(args.get('path', ''))
    if not p.is_file():
        return f'error: 不是文件: {args.get("path", "")}'
    if p.stat().st_size > 64 * 1024:
        return 'error: 文件过大（>64KB），请分段读取'
    return p.read_text(encoding='utf-8')


def _fs_write(args):
    rel = args.get('path', '')
    content = args.get('content', '')
    p = resolve_plugin_path(rel)
    pid = plugin_id_of(rel)
    if not pid:
        return 'error: 路径缺少插件目录名'
    p.parent.mkdir(parents=True, exist_ok=True)
    backup_plugin(pid)          # 写前快照，失败可回滚
    p.write_text(content, encoding='utf-8')
    deps.manager._invalidate_scan()   # 目录已变，失效扫描缓存
    return f'已写入 {rel}（{len(content)} 字节）'


# ─── 脚手架 ─────────────────────────────────────────────

def _plugin_scaffold(args):
    pid = (args.get('id') or '').strip()
    if not _ID_RE.fullmatch(pid):
        return 'error: id 只能含小写字母/数字/连字符'
    title = (args.get('name') or pid).strip() or pid
    desc = (args.get('description') or '').strip()
    target = resolve_plugin_path(pid)
    if target.exists():
        return f'error: 插件目录已存在: {pid}'
    (target / 'server').mkdir(parents=True, exist_ok=True)
    (target / 'web').mkdir(parents=True, exist_ok=True)
    (target / 'plugin.json').write_text(json.dumps({
        'id': pid, 'name': title, 'version': '0.0.1', 'icon': 'package',
        'description': desc,
        'backend': {'entry': 'server/main.py'},
        'ui': {'entry': 'web/index.js', 'route': f'/{pid}', 'dock': {'order': 100}},
    }, ensure_ascii=False, indent=2), encoding='utf-8')
    (target / 'server' / 'main.py').write_text(
        scaffold_main_py(pid), encoding='utf-8')
    (target / 'web' / 'index.js').write_text(
        scaffold_index_js(pid, title), encoding='utf-8')
    deps.manager._invalidate_scan()   # 新目录立即可发现
    return f'已生成插件 {pid}（plugin.json + server/main.py + web/index.js）'


# ─── 校验（语法 + manifest + 隔离试载）───────────────────

def _plugin_verify(args):
    pid = (args.get('id') or '').strip()
    if not _ID_RE.fullmatch(pid):
        return 'error: id 非法'
    target = resolve_plugin_path(pid)
    if not target.is_dir():
        return f'error: 插件目录不存在: {pid}'
    pj = target / 'plugin.json'
    try:
        manifest = json.loads(pj.read_text(encoding='utf-8'))
    except Exception as e:
        return f'error: plugin.json 解析失败: {e}'
    if manifest.get('id') != pid:
        return f'error: plugin.json id "{manifest.get("id")}" != 目录 {pid}'
    backend = (manifest.get('backend') or {}).get('entry')
    if not backend or not (target / backend).is_file():
        return 'error: 后端入口缺失'
    # 1) 语法
    try:
        import py_compile
        py_compile.compile(str(target / backend), doraise=True)
    except Exception as e:
        return f'error: 语法错误: {e}'
    # 2) 隔离试载（子进程 import + apply 冒烟，不污染主进程）
    try:
        proc = subprocess.run(
            [sys.executable, '-c',
             verify_script(str(settings.PROJECT_ROOT / 'server'),
                           str(target / backend), pid)],
            capture_output=True, text=True, timeout=20,
            cwd=str(settings.PROJECT_ROOT))
    except subprocess.TimeoutExpired:
        return 'error: 试载超时'
    if proc.returncode != 0:
        return f'error: 试载失败: {proc.stderr.strip()[-300:]}'
    return f'ok: {pid} 语法 + manifest + 隔离试载通过'


# ─── 装卸 / 重载 ────────────────────────────────────────

def _plugin_list(_args):
    try:
        infos = deps.manager.list_plugins()
    except Exception as e:
        return f'error: {e}'
    lines = [f'{i.name} [{i.state}] {"(app)" if i.source == "app" else "(infra)"}' for i in infos]
    return '\n'.join(lines) if lines else '(无插件)'


def _plugin_install(args):
    pid = (args.get('id') or '').strip()
    try:
        with deps.kernel_rlock:
            result = deps.manager.install(pid)
    except KeyError:
        return f'error: 未发现可安装插件: {pid}'
    except Exception as e:
        return f'error: {e}'
    if not result.ok:
        return f'error: {result.message}'
    return f'ok: {pid} -> {result.state}'


def _plugin_uninstall(args):
    pid = (args.get('id') or '').strip()
    try:
        with deps.kernel_rlock:
            result = deps.manager.uninstall(pid)
    except KeyError:
        return f'error: 未安装: {pid}'
    except Exception as e:
        return f'error: {e}'
    return f'ok: {result.message}'


def _plugin_reload(args):
    pid = (args.get('id') or '').strip()
    try:
        with deps.kernel_rlock:
            result = deps.manager.reload_plugin(pid)
    except Exception as e:
        return f'error: {e}'
    if not result.ok:
        return f'error: {result.message}'
    return f'已无重启重载: {pid}（{result.state}）'


_TOOLS = (
    ('fs_list', '列出 plugins/ 目录（或子目录）内容', _fs_list,
     {'type': 'object', 'properties': {'path': {'type': 'string', 'description': '相对 plugins/ 的路径，空为根'}}, 'required': []}),
    ('fs_read', '读取 plugins/ 内的文本文件', _fs_read,
     {'type': 'object', 'properties': {'path': {'type': 'string', 'description': '相对 plugins/ 的文件路径'}}, 'required': ['path']}),
    ('fs_write', '写文件到 plugins/（写前自动备份）', _fs_write,
     {'type': 'object', 'properties': {
         'path': {'type': 'string', 'description': '相对 plugins/ 的文件路径'},
         'content': {'type': 'string', 'description': '文件内容'}},
      'required': ['path', 'content']}),
    ('plugin_scaffold', '脚手架生成一个新 app 插件', _plugin_scaffold,
     {'type': 'object', 'properties': {
         'id': {'type': 'string', 'description': '插件 id（小写字母/数字/连字符）'},
         'name': {'type': 'string', 'description': '显示名'},
         'description': {'type': 'string', 'description': '描述'}},
      'required': ['id']}),
    ('plugin_verify', '校验插件（语法 + manifest + 隔离试载）', _plugin_verify,
     {'type': 'object', 'properties': {'id': {'type': 'string'}}, 'required': ['id']}),
    ('plugin_install', '安装插件（即时生效）', _plugin_install,
     {'type': 'object', 'properties': {'id': {'type': 'string'}}, 'required': ['id']}),
    ('plugin_uninstall', '卸载插件', _plugin_uninstall,
     {'type': 'object', 'properties': {'id': {'type': 'string'}}, 'required': ['id']}),
    ('plugin_reload', '无重启重载插件（失败自动回滚）', _plugin_reload,
     {'type': 'object', 'properties': {'id': {'type': 'string'}}, 'required': ['id']}),
    ('plugin_list', '列出已安装插件及其状态', _plugin_list,
     {'type': 'object', 'properties': {}, 'required': []}),
)


def apply(ctx, config):
    for tname, tdesc, handler, params in _TOOLS:
        ctx.tools.register({
            'name': tname,
            'description': tdesc,
            'handler': handler,
            'parameters': params,
        })
