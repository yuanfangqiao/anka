"""
FolderLoader —— 把 folder 形态插件加载为 cordis PluginMeta。

- importlib.util.spec_from_file_location 按文件路径加载，包名 app_plugins.<id>
- 复用 cordis.registry.extract_plugin_meta（模块同样导出 name/inject/provide/apply 或 Service 子类）
- meta.name 必须等于 plugin.json 的 id
- _ever_loaded 记录进程内加载过的 id：卸载后再装同名 → requires_restart（拍板语义，不做 module eviction）
"""

import importlib.util
import logging
import sys
from pathlib import Path

from .cordis.registry import PluginMeta, extract_plugin_meta
from .folder_scanner import FolderManifest

log = logging.getLogger('agentos.folder_loader')

MODULE_PREFIX = 'app_plugins'


def module_name(plugin_id: str) -> str:
    return f'{MODULE_PREFIX}.{plugin_id}'


def was_loaded(plugin_id: str) -> bool:
    return module_name(plugin_id) in sys.modules


def evict_module(plugin_id: str) -> None:
    """摘除 sys.modules 里的插件模块及其子模块（支持无重启重载）"""
    base = module_name(plugin_id)
    prefix = f'{base}.'
    for mod in [m for m in sys.modules
                if m == base or m.startswith(prefix)]:
        del sys.modules[mod]


def load_meta(manifest: FolderManifest) -> PluginMeta:
    """从 manifest 加载后端模块并提取 PluginMeta"""
    if not manifest.backend_entry:
        raise ValueError(f'插件 {manifest.id} 无后端入口（纯 UI 插件暂不支持）')

    entry = manifest.root / manifest.backend_entry
    mod_name = module_name(manifest.id)
    spec = importlib.util.spec_from_file_location(mod_name, entry)
    if spec is None or spec.loader is None:
        raise ImportError(f'无法为 {entry} 创建 module spec')

    module = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = module          # 先注册，支持模块内相对引用
    spec.loader.exec_module(module)

    meta = extract_plugin_meta(module)
    if meta is None:
        raise ValueError(f'插件 {manifest.id} 未导出 apply 或 Service 子类')
    if meta.name != manifest.id:
        raise ValueError(
            f'插件 {manifest.id} 的模块 name "{meta.name}" 与目录名不一致')
    return meta
