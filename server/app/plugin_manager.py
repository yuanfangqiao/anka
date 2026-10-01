"""
PluginManager —— cordis Loader 的服务端封装（M6：支持 folder 形态 App 插件）。

职责：
- bootstrap：infra 扁平插件 → 已安装 App 插件（installed.json）
- discover/available：FolderScanner 扫描「可安装」清单
- install/uninstall：动态装卸（首次安装即时生效；同名重装 → requires_restart）
- enable/disable：启停与级联（对 infra 与 app 插件一致）
- list_plugins：fiber 快照（同名取最新 fiber，按拓扑序输出）
- app_service：App 插件后端 Service 的通用数据通道（snapshot/call）

并发约定：所有方法都是同步的，调用方（api 层）必须经
asyncio.Lock 串行化 + asyncio.to_thread 执行（见 AGENT.md 红线 #3）。
"""

import json
import logging
import shutil
from pathlib import Path

from . import folder_loader, plugin_builder, settings
from .cordis import FiberState, Loader, RootContext
from .folder_scanner import FolderManifest, scan
from .schemas import (AppInfo, AvailablePlugin, InstallResult,
                      PluginActionResult, PluginInfo)

log = logging.getLogger('agentos.plugins')


class PluginManager:
    def __init__(self):
        self.ctx = RootContext()
        self.loader = Loader(self.ctx)
        self._disabled: set[str] = set()
        self._ever_loaded: set[str] = set()     # 进程内加载过的 app 插件 id
        self._scan_cache: dict[str, FolderManifest] | None = None
        self._installed: list[str] = self._read_installed()

    # ─── installed.json 持久化 ──────────────────────────────────

    def _read_installed(self) -> list[str]:
        f = settings.INSTALLED_FILE
        if f.is_file():
            try:
                return list(json.loads(f.read_text(encoding='utf-8')))
            except Exception as e:
                log.error('installed.json 解析失败，用默认值: %s', e)
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(settings.DEFAULT_INSTALLED, indent=2),
                     encoding='utf-8')
        return list(settings.DEFAULT_INSTALLED)

    def _write_installed(self) -> None:
        settings.INSTALLED_FILE.write_text(
            json.dumps(self._installed, indent=2, ensure_ascii=False),
            encoding='utf-8')

    # ─── 扫描与发现 ──────────────────────────────────

    def discover(self) -> dict[str, FolderManifest]:
        if self._scan_cache is None:
            self._scan_cache = scan(settings.APP_PLUGINS_DIR)
        return self._scan_cache

    def _invalidate_scan(self) -> None:
        self._scan_cache = None

    def available(self) -> list[AvailablePlugin]:
        """可安装 = 扫描发现但未安装"""
        result = []
        for m in self.discover().values():
            if m.id in self._installed:
                continue
            result.append(AvailablePlugin(
                id=m.id, name=m.name, version=m.version, icon=m.icon,
                description=m.description, errors=m.errors))
        return result

    # ─── 生命周期 ──────────────────────────────────

    def bootstrap(self, config: dict, package: str,
                  plugins_dir: str = None) -> None:
        self.loader.bootstrap(config, package=package,
                              plugins_dir=plugins_dir)
        for app_id in list(self._installed):
            m = self.discover().get(app_id)
            if m is None or m.page:
                continue                    # page 类无后端（M11）
            try:
                self._install_loaded(app_id, m)
            except Exception as e:
                log.error('安装 app 插件 %s 失败: %s', app_id, e)
            if not settings.AGENT_DEV and m.ok and m.ui_entry \
                    and not plugin_builder.has_dist(app_id):
                plugin_builder.build_web(app_id)
        log.info('bootstrap: %s', ', '.join(
            f'{i.name}={i.state}' for i in self.list_plugins()))

    # ─── 查询 ──────────────────────────────────

    def _latest_fibers(self) -> dict:
        latest = {}
        for f in self.ctx.registry['fibers']:
            latest[f.name] = f
        return latest

    def list_plugins(self) -> list[PluginInfo]:
        metas = self.loader._plugin_metas
        fibers = self._latest_fibers()
        order = {n: i for i, n in enumerate(self.loader._topo_sort(metas))}
        manifests = self.discover()

        infos = []
        for name, meta in metas.items():
            f = fibers.get(name)
            m = manifests.get(name)
            infos.append(PluginInfo(
                name=name,
                state=f.state.name if f else FiberState.DISPOSED.name,
                inject=list(meta.inject),
                provide=list(meta.provide),
                is_service=meta.is_service,
                effects=len(f._disposables) if f else 0,
                source='app' if m else 'infra',
                has_ui=bool(m and m.ui_entry),
            ))
        infos.sort(key=lambda i: order.get(i.name, 999))
        return infos

    def apps(self) -> list[AppInfo]:
        """前端宿主加载清单：已安装且有 UI 的 app 插件"""
        result = []
        for app_id in self._installed:
            m = self.discover().get(app_id)
            if not m:
                continue
            if m.page:
                # M11：page 类——静态页 iframe 加载，无后端、无编译产物，
                # entry 即静态路径（dev 由 vite 中间件伺服、prod 由 FastAPI mount 伺服）
                result.append(AppInfo(
                    id=m.id, title=m.name, icon=m.icon, route=m.route,
                    entry=f'/plugins/{m.id}/{m.page_entry}',
                    dock_order=m.dock_order, has_sidebar=False, kind='page'))
                continue
            if not m.ui_entry:
                continue
            f = self._latest_fibers().get(app_id)
            if f and f.state != FiberState.ACTIVE:
                continue                # 被禁用的 app 不出现在 dock
            # M9：生产态优先用安装时编译产物；开发态用 vite 即时编译的源码
            entry = (
                f'/plugin-dist/{m.id}/index.js'
                if not settings.AGENT_DEV and plugin_builder.has_dist(m.id)
                else f'/plugins/{m.id}/{m.ui_entry}'
            )
            result.append(AppInfo(
                id=m.id, title=m.name, icon=m.icon, route=m.route,
                entry=entry,
                dock_order=m.dock_order, has_sidebar=m.has_sidebar))
        result.sort(key=lambda a: a.dock_order)
        return result

    def app_service(self, app_id: str):
        """App 插件后端 Service（约定 provide 默认 [id]，故 ctx.<id> 即服务）"""
        return self.ctx.get(app_id)

    # ─── 安装 / 卸载 ──────────────────────────────────

    def _install_loaded(self, name: str, manifest: FolderManifest) -> str:
        """加载并启动一个从未加载过的 app 插件，返回状态名"""
        meta = folder_loader.load_meta(manifest)
        self._ever_loaded.add(name)
        self.loader._plugin_metas[meta.name] = meta
        self.loader._plugin_configs.setdefault(meta.name, {})
        self.loader._load(meta, self.loader._plugin_configs[meta.name])
        return self._latest_fibers()[name].state.name

    def install(self, name: str) -> InstallResult:
        manifest = self.discover().get(name)
        if manifest is None:
            raise KeyError(name)
        if not manifest.ok:
            raise ValueError('；'.join(manifest.errors))
        if name in self._installed:
            return InstallResult(name=name, ok=True, state='ACTIVE',
                                 message='插件已安装')
        if manifest.page:
            # M11：page 类无后端无编译，装上即生效
            self._installed.append(name)
            self._write_installed()
            self._invalidate_scan()
            log.info('install page %s', name)
            return InstallResult(name=name, ok=True, state='PAGE',
                                 message='静态页应用已安装')
        if name in self._ever_loaded or folder_loader.was_loaded(name):
            # 拍板语义：同名重装需重启（不做 module eviction）
            return InstallResult(
                name=name, ok=False, requires_restart=True,
                message='同名插件曾在本进程加载，请重启后端后再安装')

        try:
            state = self._install_loaded(name, manifest)
        except Exception as e:
            log.exception('install %s failed', name)
            return InstallResult(name=name, ok=False,
                                 state=FiberState.FAILED.name, message=str(e))

        # M9：生产态安装即编译插件前端（产物缓存 .plugin-dist/<id>/）
        if not settings.AGENT_DEV:
            plugin_builder.build_web(name)

        self._installed.append(name)
        self._write_installed()
        self._invalidate_scan()
        log.info('install %s -> %s', name, state)
        return InstallResult(name=name, ok=True, state=state)

    def uninstall(self, name: str) -> PluginActionResult:
        if name not in self._installed:
            raise KeyError(name)

        m = self.discover().get(name)
        if m and m.page:
            # M11：page 类无 fiber/meta 可摘，移出 installed 即可
            self._installed.remove(name)
            self._write_installed()
            self._invalidate_scan()
            log.info('uninstall page %s', name)
            return PluginActionResult(
                name=name, ok=True, state='UNINSTALLED', cascaded=[],
                message='静态页应用已移除；刷新页面后彻底消失')

        res = self.disable(name)                    # 级联卸载 + 记录
        # 摘除目标 meta 与 fiber（依赖者保留 meta，仅处 DISPOSED）
        self.loader._plugin_metas.pop(name, None)
        self.loader._plugin_configs.pop(name, None)
        for f in list(self.ctx.registry['fibers']):
            if f.name == name:
                self.loader.remove_fiber(f)
                self.ctx.reflect.discard_fiber(f)
        self._disabled.discard(name)

        self._installed.remove(name)
        self._write_installed()
        self._invalidate_scan()
        dist = settings.PLUGIN_DIST_DIR / name      # M9：清掉前端构建产物
        if dist.is_dir():
            shutil.rmtree(dist, ignore_errors=True)
        log.info('uninstall %s, cascaded=%s', name, res.cascaded)
        return PluginActionResult(
            name=name, ok=True, state='UNINSTALLED', cascaded=res.cascaded,
            message='已卸载；刷新页面后彻底移除')

    # ─── 启停 ──────────────────────────────────

    def disable(self, name: str) -> PluginActionResult:
        m = self.discover().get(name)
        if m and m.page:
            return PluginActionResult(      # M11：page 类无启停语义
                name=name, ok=True, state='PAGE', cascaded=[],
                message='静态页应用不支持启停')

        metas = self.loader._plugin_metas
        if name not in metas:
            raise KeyError(name)

        before = {f.name: f.state for f in self.ctx.registry['fibers']}
        unloaded = self.loader.unload_plugin(name)
        if not unloaded:
            return PluginActionResult(
                name=name, ok=True, state=FiberState.DISPOSED.name,
                cascaded=[], message='插件已处于卸载状态')

        cascaded = [
            f.name for f in self.ctx.registry['fibers']
            if f.name != name
            and before.get(f.name) != FiberState.DISPOSED
            and f.state == FiberState.DISPOSED
        ]
        cascaded = list(dict.fromkeys(cascaded))

        self._disabled.add(name)
        self._disabled.update(cascaded)
        log.info('disable %s, cascaded=%s', name, cascaded)
        return PluginActionResult(
            name=name, ok=True, state=FiberState.DISPOSED.name,
            cascaded=cascaded)

    def enable(self, name: str) -> PluginActionResult:
        m = self.discover().get(name)
        if m and m.page:
            return PluginActionResult(      # M11：page 类无启停语义
                name=name, ok=True, state='PAGE', cascaded=[],
                message='静态页应用不支持启停')

        metas = self.loader._plugin_metas
        if name not in metas:
            raise KeyError(name)

        provide_map = {}
        for n, m in metas.items():
            for svc in m.provide:
                provide_map[svc] = n

        rebuild = {name}
        changed = True
        while changed:
            changed = False
            for n in list(self._disabled):
                if n in rebuild:
                    continue
                if any(provide_map.get(svc) in rebuild for svc in metas[n].inject):
                    rebuild.add(n)
                    changed = True

        for f in list(self.ctx.registry['fibers']):
            if f.name in rebuild:
                self.loader.remove_fiber(f)
                self.ctx.reflect.discard_fiber(f)

        subset = {n: metas[n] for n in rebuild}
        try:
            for n in self.loader._topo_sort(subset):
                self.loader._load(subset[n],
                                  self.loader._plugin_configs.get(n, {}))
        except Exception as e:
            log.exception('enable %s failed', name)
            return PluginActionResult(
                name=name, ok=False, state=FiberState.FAILED.name,
                cascaded=[], message=str(e))

        self._disabled -= rebuild
        state = self._latest_fibers()[name].state.name
        cascaded = sorted(rebuild - {name})
        log.info('enable %s, rebuilt=%s', name, sorted(rebuild))
        return PluginActionResult(
            name=name, ok=True, state=state, cascaded=cascaded)
