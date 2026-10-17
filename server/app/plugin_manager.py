"""
PluginManager —— cordis Loader 的服务端封装（内核装载职责）。

职责（P1 收窄）：
- bootstrap：infra 扁平插件 + 已安装 App 插件（ledger 投影）
- _install_loaded：import → meta → fiber（供 PluginService 回调）
- enable/disable：启停与级联
- reload_plugin：备份 → 卸载 → 模块驱逐 → 重载 → 回滚
- list_plugins：fiber 快照（同名取最新 fiber，按拓扑序输出）
- app_service：App 插件后端 Service 的通用数据通道（snapshot/call）

扫描、可安装清单、安装决策、ledger 写入、前端应用清单已下沉到
`plugin_service.PluginService`；本类保留同名 facade 以兼容既有调用点。

并发约定：所有方法都是同步的，调用方（api 层）必须经
asyncio.Lock 串行化 + asyncio.to_thread 执行（见 AGENT.md 红线 #3）。
"""

import logging
import shutil
import time

from . import folder_loader, plugin_builder, settings
from .cordis import FiberState, Loader, RootContext
from .folder_scanner import FolderManifest
from .plugin_service import PluginService
from .schemas import (AppInfo, AvailablePlugin, InstallResult,
                      PluginActionResult, PluginInfo)

log = logging.getLogger('agentos.plugins')


class PluginManager:
    def __init__(self) -> None:
        self.ctx = RootContext()
        self.loader = Loader(self.ctx)
        self._disabled: set[str] = set()
        self._ever_loaded: set[str] = set()     # 进程内加载过的 app 插件 id
        self.service = PluginService(
            on_load=self._install_loaded,
            on_uninstall=self._uninstall_kernel,
            state_probe=self._fiber_state,
            was_loaded=self._was_loaded,
        )

    # ─── 内核回调（注入 PluginService）──────────────────

    def _install_loaded(self, name: str, manifest: FolderManifest) -> str:
        """加载并启动一个从未加载过的 app 插件，返回状态名"""
        meta = folder_loader.load_meta(manifest)
        self._ever_loaded.add(name)
        self.loader._plugin_metas[meta.name] = meta
        self.loader._plugin_configs.setdefault(meta.name, {})
        self.loader._load(meta, self.loader._plugin_configs[meta.name])
        return self._latest_fibers()[name].state.name

    def _was_loaded(self, name: str) -> bool:
        return name in self._ever_loaded or folder_loader.was_loaded(name)

    def _fiber_state(self, name: str) -> str | None:
        f = self._latest_fibers().get(name)
        return f.state.name if f else None

    def _uninstall_kernel(self, name: str) -> PluginActionResult:
        """级联 disable → 摘 meta/fiber → 清内存启用态（不含 ledger）"""
        res = self.disable(name)
        self.loader._plugin_metas.pop(name, None)
        self.loader._plugin_configs.pop(name, None)
        for f in list(self.ctx.registry['fibers']):
            if f.name == name:
                self.loader.remove_fiber(f)
                self.ctx.reflect.discard_fiber(f)
        self._disabled.discard(name)
        return res

    # ─── 扫描与发现（facade）──────────────────────────

    def discover(self):
        return self.service.discover()

    def _invalidate_scan(self) -> None:
        self.service.invalidate()

    def available(self) -> list[AvailablePlugin]:
        return self.service.available()

    def apps(self) -> list[AppInfo]:
        return self.service.apps()

    # ─── 生命周期 ──────────────────────────────────

    def bootstrap(self, config: dict, package: str,
                  plugins_dir: str = None) -> None:
        self.loader.bootstrap(config, package=package,
                              plugins_dir=plugins_dir)
        for app_id in self.service.installed_ids():
            m = self.discover().get(app_id)
            if m is None or m.page:
                continue                    # page 类无后端（M11）
            try:
                self._install_loaded(app_id, m)
            except Exception as e:
                log.error('安装 app 插件 %s 失败: %s', app_id, e)
                continue
            if not settings.AGENT_DEV and m.ok and m.ui_entry \
                    and plugin_builder.is_stale(app_id):
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
                version=m.version if m else '',
                kind=m.kind if m else 'infra',
                requires_build=bool(m and m.build),
            ))

        # page 类不进 cordis（无 fiber），但需要出现在插件管理页：
        # 展示版本 + 提供「加载更新」（重跑 build.steps 并重挂 iframe）
        for pid in self.service.installed_ids():
            m = manifests.get(pid)
            if m and m.page:
                infos.append(PluginInfo(
                    name=pid, state='PAGE', inject=[], provide=[],
                    is_service=False, effects=0, source='app', has_ui=False,
                    version=m.version, kind='page',
                    requires_build=bool(m.build)))

        infos.sort(key=lambda i: order.get(i.name, 999))
        return infos

    def app_service(self, app_id: str):
        """App 插件后端 Service（约定 provide 默认 [id]，故 ctx.<id> 即服务）"""
        return self.ctx.get(app_id)

    # ─── 安装 / 卸载（facade）──────────────────────────

    def install(self, name: str) -> InstallResult:
        return self.service.install(name)

    def uninstall(self, name: str) -> PluginActionResult:
        return self.service.uninstall(name)

    def build(self, name: str) -> PluginActionResult:
        """重新构建源码型 page 插件（前端「加载更新」入口）"""
        return self.service.build(name)

    # ─── 无重启重载（M14）──────────────────────────────

    def reload_plugin(self, name: str) -> PluginActionResult:
        """无重启重载：备份 → 级联卸载 → 摘 meta + 模块驱逐 → 重载 → 失败回滚。

        调用方须持 deps.kernel_rlock 串行化（harness_tools 已保证）。
        """
        self._invalidate_scan()
        manifest = self.discover().get(name)
        if manifest is None:
            raise KeyError(name)
        if manifest.page:
            return PluginActionResult(
                name=name, ok=True, state='PAGE', cascaded=[],
                message='静态页应用无需重载')

        metas = self.loader._plugin_metas
        if name not in metas:
            raise KeyError(name)

        ts = time.strftime('%Y%m%d-%H%M%S')
        backup_dir = settings.PROJECT_ROOT / '.plugin-backup' / name / f'reload-{ts}'
        shutil.copytree(manifest.root, backup_dir, dirs_exist_ok=True)

        def _reload_from_disk():
            self._invalidate_scan()
            m = self.discover().get(name)
            folder_loader.evict_module(name)
            meta = folder_loader.load_meta(m)
            self.loader._plugin_metas[meta.name] = meta
            self.loader._plugin_configs.setdefault(meta.name, {})
            return meta

        def _rollback(reason: str) -> PluginActionResult:
            shutil.rmtree(manifest.root, ignore_errors=True)
            shutil.copytree(backup_dir, manifest.root, dirs_exist_ok=True)
            try:
                _reload_from_disk()
            except Exception as e2:
                return PluginActionResult(
                    name=name, ok=False, state=FiberState.FAILED.name,
                    cascaded=[], message=f'重载失败({reason})且回滚失败: {e2}')
            try:
                self.enable(name)
            except Exception as e3:
                return PluginActionResult(
                    name=name, ok=False, state=FiberState.FAILED.name,
                    cascaded=[], message=f'重载失败({reason})，回滚重建失败: {e3}')
            return PluginActionResult(
                name=name, ok=False, state='ACTIVE', cascaded=[],
                message=f'重载失败已回滚: {reason}')

        # 1) 级联卸载（依赖者一并 DISPOSED 并记入 _disabled）
        self.disable(name)

        # 2) 摘旧 meta + 模块驱逐
        self.loader._plugin_metas.pop(name, None)
        self.loader._plugin_configs.pop(name, None)

        # 3) 重载新代码
        try:
            _reload_from_disk()
        except Exception as e:
            return _rollback(str(e))

        # 4) 重建（enable 处理依赖者级联）
        try:
            result = self.enable(name)
        except Exception as e:
            return _rollback(str(e))
        if not result.ok:
            return _rollback(result.message)

        log.info('reload %s -> %s, cascaded=%s', name, result.state, result.cascaded)
        return PluginActionResult(
            name=name, ok=True, state=result.state, cascaded=result.cascaded,
            message='已无重启重载')

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

        # 按 metas 的原始顺序（bootstrap 时按文件名排序）构造 subset，
        # 避免 set 迭代顺序随 hash 种子变化导致 adapter 注册顺序（进而
        # 'default' 模型解析）在不同进程间不确定。
        subset = {n: metas[n] for n in metas if n in rebuild}
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
