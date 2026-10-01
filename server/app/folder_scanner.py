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
    page_entry: str | None = None        # M11 降级形态：静态页入口（相对插件目录）
    dock_order: int = 100
    has_sidebar: bool = False
    route: str = ''
    root: Path = field(default_factory=Path)
    errors: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors

    @property
    def page(self) -> bool:
        """M11：任意静态页应用（无 plugin.json、无后端、iframe 伺服）"""
        return self.page_entry is not None


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


# M11：无 plugin.json 时的降级探测入口（按优先级）
PAGE_ENTRIES = ('index.html', 'dist/index.html', 'web/index.html')


def _parse_page_fallback(root: Path) -> FolderManifest | None:
    """任意可伺服的静态页面目录 → page 类 manifest（无后端、iframe 加载）"""
    for entry in PAGE_ENTRIES:
        if (root / entry).is_file():
            folder = root.name
            return FolderManifest(
                id=folder, name=folder, version='0.0.0',
                icon='package',
                description='静态页面应用（自动发现，无 plugin.json）',
                page_entry=entry,
                dock_order=100,
                route=f'/app/{folder}',
                root=root,
            )
    log.warning('目录 %s 无 plugin.json 且未发现静态入口 %s，忽略',
                root.name, PAGE_ENTRIES)
    return None


def scan(plugins_dir: Path) -> dict[str, FolderManifest]:
    """扫描目录，返回 {id: manifest}；坏插件也返回（带 errors）。
    M11：无 plugin.json 的目录按静态页应用降级探测。"""
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
        elif child.is_dir():
            m = _parse_page_fallback(child)
            if m:
                found[m.id] = m
                log.info('发现静态页应用（自动）: %s -> %s', m.id, m.route)
    return found
