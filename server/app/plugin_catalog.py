"""Installed frontend catalog, independent of plugin installation mutations."""
import logging

from . import plugin_builder, settings
from .schemas import AppInfo

log = logging.getLogger('agentos.plugin_catalog')


def apps(self) -> list[AppInfo]:
    """已安装且有 UI 的 app 插件 + page 类静态应用"""
    result = []
    manifests = self.discover()
    for app_id in self.installed_ids():
        m = manifests.get(app_id)
        if not m:
            log.warning('ledger 中已安装但目录缺失: %s', app_id)
            continue
        if m.page:
            # page 类：静态页 iframe 加载；源码型插件构建后靠产物 mtime 换 URL，
            # 让前端重挂 iframe 时拿到新构建（浏览器不会复用旧 index.html）
            page_entry = m.page_entry or ''
            entry = f'/plugins/{m.id}/{page_entry}'
            out = m.root / page_entry.split('?', 1)[0]
            if page_entry and out.is_file():
                entry += f'?v={int(out.stat().st_mtime)}'
            result.append(AppInfo(
                id=m.id, title=m.name, icon=m.icon, route=m.route,
                entry=entry,
                dock_order=m.dock_order, has_sidebar=False, kind='page'))
            continue
        if not m.ui_entry:
            continue
        state = self._state_probe(app_id)
        if state and state != 'ACTIVE':
            continue                # 被禁用的 app 不出现在 dock
        if not settings.AGENT_DEV and plugin_builder.has_dist(m.id):
            stamp = (settings.PLUGIN_DIST_DIR / m.id / 'index.js').stat().st_mtime_ns
            entry = f'/plugin-dist/{m.id}/index.js?v={stamp}'
            style = plugin_builder.css_url(m.id)      # 插件自带样式（工具类）
            if not style:
                # 旧产物（本机制上线前构建）：插件里的 Tailwind 类不会被宿主 CSS 兜住
                log.warning('插件 %s 缺少样式产物 index.css，请重建/重装插件', m.id)
        else:
            entry = f'/plugins/{m.id}/{m.ui_entry}'    # dev：vite 即时编译，样式随之而来
            style = ''
        result.append(AppInfo(
            id=m.id, title=m.name, icon=m.icon, route=m.route,
            entry=entry, style=style,
            dock_order=m.dock_order, has_sidebar=m.has_sidebar))
    result.sort(key=lambda a: a.dock_order)
    return result

