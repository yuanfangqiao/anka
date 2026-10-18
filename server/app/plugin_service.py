"""PluginService —— 插件的应用层职责（扫描 / 决策 / ledger / 前端清单）。

与内核的分工：
- 本模块决定「装什么、能不能装、装完记什么」，不碰 cordis；
- PluginManager 负责「怎么加载、怎么卸载、怎么启停」，通过构造注入的
  `on_load` / `on_uninstall` / `state_probe` 回调把动作委托回来。

依赖方向：service → scanner / ledger / builder，**不得 import plugin_manager**。
"""

import logging
import shutil
from pathlib import Path
from typing import Callable

from . import plugin_builder, settings
from .folder_scanner import FolderManifest, scan
from .ledger import Ledger
from .schemas import AppInfo, AvailablePlugin, InstallResult, PluginActionResult

log = logging.getLogger('agentos.plugin_service')


class ServiceError(ValueError):
    """带稳定错误码的应用层异常（API 层据此映射 HTTP 状态）。"""

    def __init__(self, message: str, code: str = 'E_MANIFEST_FIELD',
                 plugin: str = '') -> None:
        super().__init__(message)
        self.code = code
        self.plugin = plugin


# 内核回调签名
OnLoad = Callable[[str, FolderManifest], str]        # -> fiber 状态名
OnUninstall = Callable[[str], PluginActionResult]    # -> 级联卸载结果
StateProbe = Callable[[str], 'str | None']           # -> fiber 状态名 / None
WasLoaded = Callable[[str], bool]                    # 进程内曾加载过该模块


class PluginService:
    def __init__(self, *, on_load: OnLoad, on_uninstall: OnUninstall,
                 state_probe: StateProbe, was_loaded: WasLoaded,
                 ledger: Ledger | None = None,
                 plugins_dir: Path | None = None) -> None:
        self._on_load = on_load
        self._on_uninstall = on_uninstall
        self._state_probe = state_probe
        self._was_loaded = was_loaded
        self.plugins_dir = Path(plugins_dir or settings.APP_PLUGINS_DIR)
        self.ledger = ledger or Ledger()
        self._scan_cache: dict[str, FolderManifest] | None = None
        self.ledger.migrate_from_json(settings.INSTALLED_FILE)

    # ─── 扫描与发现 ──────────────────────────────────

    def discover(self, refresh: bool = False) -> dict[str, FolderManifest]:
        if refresh or self._scan_cache is None:
            self._scan_cache = scan(self.plugins_dir)
        return self._scan_cache

    def invalidate(self) -> None:
        self._scan_cache = None

    def installed_ids(self) -> list[str]:
        return self.ledger.installed_ids()

    def is_installed(self, plugin_id: str) -> bool:
        return self.ledger.state_of(plugin_id) == 'installed'

    def available(self) -> list[AvailablePlugin]:
        """可安装 = 扫描发现但未安装（失败的安装也会回到这里）"""
        installed = set(self.installed_ids())
        result = []
        for m in self.discover().values():
            if m.id in installed:
                continue
            result.append(AvailablePlugin(
                id=m.id, name=m.name, version=m.version, icon=m.icon,
                description=m.description, errors=m.errors,
                kind=m.kind, codes=m.codes,
                requires_build=bool(m.build)))
        return result

    # ─── 安装 / 卸载 ──────────────────────────────────

    def install(self, name: str) -> InstallResult:
        manifest = self.discover().get(name)
        if manifest is None:
            raise ServiceError(f'plugins/ 目录下未发现插件 "{name}"',
                               code='E_NOT_FOUND', plugin=name)
        if not manifest.ok:
            raise ServiceError('；'.join(manifest.errors),
                               code=manifest.codes[0], plugin=name)
        if self.is_installed(name):
            return InstallResult(name=name, ok=True, state='ACTIVE',
                                 message='插件已安装')

        if manifest.page:
            # page 类无后端；声明 build 的源码型插件先现场构建产物（dist 不入库）
            if manifest.build:
                ok, msg = plugin_builder.build_recipe(name, manifest)
                if not ok:
                    self.ledger.mark('failed', name, version=manifest.version,
                                     kind='page', source='manifest',
                                     detail={'error': msg[:500]})
                    raise ServiceError(msg, code='E_BUILD_FAILED', plugin=name)
                self.invalidate()
            self.ledger.mark('installed', name, version=manifest.version,
                             kind='page', source='manifest' if manifest.manifest_version
                             else 'auto')
            self.invalidate()
            log.info('install page %s', name)
            return InstallResult(name=name, ok=True, state='PAGE',
                                 message='已构建并安装' if manifest.build
                                 else '静态页应用已安装')

        if self._was_loaded(name):
            return InstallResult(
                name=name, ok=False, requires_restart=True,
                code='E_RESTART_REQUIRED',
                message='同名插件曾在本进程加载，请重启后端后再安装')

        try:
            state = self._on_load(name, manifest)
        except Exception as e:
            self.ledger.mark('failed', name, version=manifest.version,
                             kind=manifest.kind, source='manifest',
                             detail={'error': str(e)[:500]})
            raise ServiceError(str(e), code='E_LOAD_FAILED', plugin=name) from e

        # 生产态安装即编译插件前端（产物缓存 .plugin-dist/<id>/）
        if not settings.AGENT_DEV:
            plugin_builder.build_web(name)

        self.ledger.mark('installed', name, version=manifest.version,
                         kind=manifest.kind, source='manifest')
        self.invalidate()
        log.info('install %s -> %s', name, state)
        return InstallResult(name=name, ok=True, state=state)

    def build(self, name: str) -> PluginActionResult:
        """重新构建已安装的源码型 page 插件（前端「加载更新」）。

        只重跑 manifest.build.steps，产物仍在插件目录内；成功后宿主清单的
        入口 URL 带上产物 mtime，前端重挂 iframe 即加载新版本。
        """
        manifest = self.discover(refresh=True).get(name)
        if manifest is None:
            raise KeyError(name)
        if not self.is_installed(name):
            raise ServiceError(f'插件 "{name}" 未安装', code='E_NOT_INSTALLED',
                               plugin=name)
        if not manifest.build:
            raise ServiceError(f'插件 "{name}" 未声明 build 配方',
                               code='E_NO_BUILD', plugin=name)
        ok, msg = plugin_builder.build_recipe(name, manifest)
        if not ok:
            raise ServiceError(msg, code='E_BUILD_FAILED', plugin=name)
        self.invalidate()
        return PluginActionResult(name=name, ok=True, state='PAGE', message=msg)

    def uninstall(self, name: str) -> PluginActionResult:
        if not self.is_installed(name):
            raise KeyError(name)

        m = self.discover().get(name)
        if m and m.page:
            self.ledger.mark('uninstalled', name, kind='page')
            self.invalidate()
            log.info('uninstall page %s', name)
            return PluginActionResult(
                name=name, ok=True, state='UNINSTALLED', cascaded=[],
                message='静态页应用已移除；刷新页面后彻底消失')

        res = self._on_uninstall(name)        # 级联 disable + 摘 meta/fiber

        dist = settings.PLUGIN_DIST_DIR / name
        if dist.is_dir():
            shutil.rmtree(dist, ignore_errors=True)

        self.ledger.mark('uninstalled', name, kind=(m.kind if m else ''))
        self.invalidate()
        log.info('uninstall %s, cascaded=%s', name, res.cascaded)
        return PluginActionResult(
            name=name, ok=True, state='UNINSTALLED', cascaded=res.cascaded,
            message='已卸载；刷新页面后彻底移除')

    # ─── 前端宿主清单 ──────────────────────────────────

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
                entry = f'/plugin-dist/{m.id}/index.js'
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

    # ─── 体检（CLI doctor）──────────────────────────────

    def health_report(self, refresh: bool = True) -> list[dict]:
        """扫描与 ledger 投影的交叉校验，不启动内核。"""
        manifests = self.discover(refresh=refresh)
        records = self.ledger.records()
        rows: list[dict] = []

        for pid, m in sorted(manifests.items()):
            rec = records.get(pid) or {}
            issues: list[str] = list(m.errors)
            if rec.get('state') == 'installed' and not m.ok:
                issues.append('ledger 记录为已安装，但 manifest 校验失败')
            built_on_demand = bool((m.build or {}).get('steps'))
            pending = (built_on_demand and m.page_entry is not None
                       and not (m.root / m.page_entry).is_file())
            if m.kind == 'page' and not m.page_entry:
                issues.append('page 类缺少 page.entry 或 build.output.entry')
            elif pending:
                pass          # 源码型插件：产物未构建属正常，安装/更新时构建
            elif m.page and m.page_entry and not (m.root / m.page_entry).is_file():
                issues.append(f'page 入口不存在: {m.page_entry}（需要提交构建产物）')
            rows.append({
                'id': pid,
                'kind': m.kind,
                'version': m.version,
                'installed': rec.get('state') == 'installed',
                'ledger_state': rec.get('state'),
                'manifest_ok': m.ok,
                'codes': m.codes,
                'root': str(m.root),
                'entry': m.ui_entry or m.page_entry or m.backend_entry,
                'build_pending': bool(pending),
                'issues': issues,
            })

        for pid, rec in sorted(records.items()):
            if pid in manifests:
                continue
            rows.append({
                'id': pid,
                'kind': rec.get('kind') or '?',
                'version': rec.get('version') or '?',
                'installed': rec.get('state') == 'installed',
                'ledger_state': rec.get('state'),
                'manifest_ok': False,
                'codes': [],
                'root': '',
                'entry': None,
                'issues': ['ledger 有记录，但 plugins/ 下目录缺失'],
            })
        return rows

    # ─── 诊断 ──────────────────────────────────

    def reconcile(self) -> list[str]:
        """清理幽灵记录：ledger 为 installed 但 plugins/ 下已无目录。

        只做 uninstall 方向的修正（append 一条 `uninstalled` 保留审计），
        绝不反向自动安装，避免临时挂载未就绪时误伤。
        """
        manifests = self.discover(refresh=True)
        dropped: list[str] = []
        for pid in self.installed_ids():
            if pid in manifests:
                continue
            self.ledger.mark('uninstalled', pid, source='doctor',
                             detail={'reason': 'missing_dir',
                                     'by': 'doctor --fix'})
            dropped.append(pid)
        if dropped:
            log.info('ledger 幽灵记录已清理: %s', ', '.join(dropped))
        return dropped

    def ledger_problems(self) -> list[str]:
        return list(self.ledger.problems)
