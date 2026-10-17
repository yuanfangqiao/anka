"""harness 共享支撑（M14，非插件，仅被 harness-tools / harness-guard import）。

把「沙箱路径策略 + 脚手架模板 + 隔离试载脚本」从 harness_tools 抽出，
以遵守 AGENT.md 红线 #6（单文件 ≤300 行）。此文件不在 PLUGIN_CONFIG 内，
不会被 loader 当作插件加载。
"""

import re
import shutil
import time
from pathlib import Path

from app import settings

_ID_RE = re.compile(r'^[a-z0-9-]+$')
_BACKUP_ROOT = settings.PROJECT_ROOT / '.plugin-backup'

# 只读文档白名单：Agent 开发插件前需要读规范，但**永远不可写**。
# key 是工具视角的路径（fs_read 的 path 原样比较），value 是真实文件。
_READONLY_DOCS = {
    'README.md': settings.APP_PLUGINS_DIR / 'README.md',
    'plugins/README.md': settings.APP_PLUGINS_DIR / 'README.md',
    'docs/PLUGIN-SPEC.md': settings.PROJECT_ROOT / 'docs' / 'PLUGIN-SPEC.md',
    'docs/NAVIGATION.md': settings.PROJECT_ROOT / 'docs' / 'NAVIGATION.md',
}


def _normalize(rel: str) -> str:
    key = (rel or '').replace('\\', '/').strip()
    while key.startswith('./'):
        key = key[2:]
    return key.lstrip('/')


def resolve_plugin_path(rel: str) -> Path:
    """把相对路径收敛到 plugins/ 内；拒绝绝对路径、.. 穿越、符号链接逃逸。

    与 harness_guard 共享同一份策略（sandbox-policy），保证限制到同一个根。
    """
    base = settings.APP_PLUGINS_DIR.resolve()
    p = (base / (rel or '')).resolve()
    if not p.is_relative_to(base):
        raise ValueError(f'路径越界（限定在 plugins/ 内）: {rel}')
    return p


def resolve_read_path(rel: str) -> Path:
    """fs_read 专用：插件区 + 只读文档白名单。

    写路径仍走 resolve_plugin_path，文档不在可写范围内。
    """
    doc = _READONLY_DOCS.get(_normalize(rel))
    if doc is not None:
        return doc.resolve()
    return resolve_plugin_path(rel)


def is_plugin_file_path(rel: str) -> bool:
    """可写路径必须是 plugins/<id>/<file>，禁止写到 plugins/ 根（如 README.md）
    或只读文档（README.md / docs/**）。"""
    key = _normalize(rel)
    if key in _READONLY_DOCS or key.startswith('docs/'):
        return False
    parts = [p for p in Path(key).parts if p != '.']
    return len(parts) >= 2 and bool(_ID_RE.fullmatch(parts[0]))


def plugin_id_of(rel: str) -> str:
    parts = [p for p in Path(rel).parts if p not in ('.', '..')]
    return parts[0] if parts else ''


def backup_plugin(plugin_id: str) -> Path | None:
    """把 plugins/<id>/ 整目录快照到 .plugin-backup/<id>/<ts>/"""
    src = settings.APP_PLUGINS_DIR / plugin_id
    if not src.is_dir():
        return None
    ts = time.strftime('%Y%m%d-%H%M%S')
    dst = _BACKUP_ROOT / plugin_id / ts
    dst.mkdir(parents=True, exist_ok=True)
    shutil.copytree(src, dst, dirs_exist_ok=True)
    return dst


def scaffold_main_py(pid: str) -> str:
    return f'''"""插件：{pid}（harness 脚手架生成）"""
name = '{pid}'
inject = ['tools']


def _hello(args):
    return f'hello from {pid}: {{args.get("name", "world")}}'


def apply(ctx, config):
    ctx.tools.register({{
        'name': '{pid}-hello',
        'description': 'Say hello from {pid}',
        'handler': _hello,
        'parameters': {{
            'type': 'object',
            'properties': {{'name': {{'type': 'string'}}}},
            'required': [],
        }},
    }})
'''


def scaffold_index_js(pid: str, title: str) -> str:
    return f'''/** {title} —— harness 脚手架生成 */
export function setup(uiCtx) {{
  const {{ vue, components, icons }} = uiCtx
  const {{ defineComponent, h }} = vue
  const {{ BaseCard }} = components
  const {{ Package }} = icons
  const Page = defineComponent({{
    name: '{pid.title()}',
    setup() {{
      return () => h('div', {{ class: 'flex h-full flex-col gap-3 p-3' }}, [
        h('h1', {{ class: 'text-[30px] font-bold tracking-tight' }}, '{title}'),
        h(BaseCard, {{ class: '!p-4' }}, () => [
          h('span', {{ class: 'text-sm text-ink-1' }}, '由 harness 脚手架生成，可在对话中让 Agent 继续开发。'),
        ]),
      ])
    }},
  }})
  uiCtx.registerApp({{
    id: '{pid}', title: '{title}', icon: 'package',
    route: '/{pid}', order: 100, component: Page,
  }})
}}
'''


def verify_script(server_dir: str, entry: str, pid: str) -> str:
    return f'''import importlib.util, sys
sys.path.insert(0, {server_dir!r})
from app.cordis.registry import extract_plugin_meta
spec = importlib.util.spec_from_file_location("app_plugins.{pid}", {entry!r})
module = importlib.util.module_from_spec(spec)
sys.modules["app_plugins.{pid}"] = module
spec.loader.exec_module(module)
meta = extract_plugin_meta(module)
if meta is None:
    raise SystemExit("未导出 apply 或 Service 子类")
if meta.name != {pid!r}:
    raise SystemExit("name %r 与目录 %r 不一致" % (meta.name, {pid!r}))
if not meta.is_service:
    class _Any:
        def __getattr__(self, n): return _Any()
        def __call__(self, *a, **k): return _Any()
    try:
        meta.plugin_obj(_Any(), {{}})
    except Exception as e:
        raise SystemExit("apply 冒烟失败: %s" % e)
print("ok")
'''
