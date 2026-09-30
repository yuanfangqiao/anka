"""
FolderScanner —— 扫描应用插件目录，产出「可安装」清单。

扫描 <项目根>/plugins/<name>/plugin.json，校验必需字段与入口文件存在性。
结果由 PluginManager 缓存，安装/卸载后失效重建。
"""

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger('agentos.scanner')

REQUIRED_FIELDS = ('id', 'name', 'version')


@dataclass
class FolderManifest:
    id: str
    name: str
    version: str
    icon: str = 'package'
    system: bool = False
    description: str = ''
    backend_entry: str | None = None     # 相对插件目录，如 server/main.py
    ui_entry: str | None = None          # 相对插件目录，如 web/index.js
    dock_order: int = 100
    has_sidebar: bool = False
    route: str = ''
    root: Path = field(default_factory=Path)
    errors: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


def _parse(plugin_json: Path) -> FolderManifest:
    errors: list[str] = []
    try:
        data = json.loads(plugin_json.read_text(encoding='utf-8'))
    except Exception as e:
        return FolderManifest(id=plugin_json.parent.name, name='?', version='?',
                              root=plugin_json.parent,
                              errors=[f'plugin.json 解析失败: {e}'])

    for f in REQUIRED_FIELDS:
        if f not in data:
            errors.append(f'缺少字段 {f}')

    backend = data.get('backend') or {}
    ui = data.get('ui') or {}
    m = FolderManifest(
        id=data.get('id', plugin_json.parent.name),
        name=data.get('name', plugin_json.parent.name),
        version=data.get('version', '?'),
        icon=data.get('icon', 'package'),
        system=bool(data.get('system', False)),
        description=data.get('description', ''),
        backend_entry=backend.get('entry'),
        ui_entry=ui.get('entry'),
        dock_order=int((ui.get('dock') or {}).get('order', 100)),
        has_sidebar=bool(ui.get('sidebar', False)),
        route=ui.get('route') or f"/{data.get('id', plugin_json.parent.name)}",
        root=plugin_json.parent,
        errors=errors,
    )

    if m.id != plugin_json.parent.name:
        m.errors.append(f'id "{m.id}" 与目录名 "{plugin_json.parent.name}" 不一致')
    if m.backend_entry and not (m.root / m.backend_entry).is_file():
        m.errors.append(f'后端入口不存在: {m.backend_entry}')
    if m.ui_entry and not (m.root / m.ui_entry).is_file():
        m.errors.append(f'前端入口不存在: {m.ui_entry}')
    return m


def scan(plugins_dir: Path) -> dict[str, FolderManifest]:
    """扫描目录，返回 {id: manifest}；坏插件也返回（带 errors）"""
    found: dict[str, FolderManifest] = {}
    if not plugins_dir.is_dir():
        log.warning('plugins dir not found: %s', plugins_dir)
        return found
    for child in sorted(plugins_dir.iterdir()):
        pj = child / 'plugin.json'
        if child.is_dir() and pj.is_file():
            m = _parse(pj)
            found[m.id] = m
            if not m.ok:
                log.error('插件 %s 校验失败: %s', m.id, m.errors)
    return found
