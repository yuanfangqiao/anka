"""
cordis.loader — 插件加载器与拓扑排序

流程：扫描 → 拓扑排序 → 逐个加载（设置 _current_loading_fiber）

PATCH（见 PATCHES.md）：
  #1 bootstrap 增加 package 参数（原版硬编码 'plugins' 包名）
  #2 扫描失败 print → logging
  #4 新增 remove_fiber()（支持 PluginManager 重建 fiber）
"""

import importlib
import logging
import os
import sys
from collections import defaultdict
from typing import Optional

from .context import RootContext
from .fiber import Fiber, FiberState
from .registry import extract_plugin_meta

log = logging.getLogger('cordis.loader')


class Loader:
    """插件加载器：dict 配置 + 拓扑排序 + 级联卸载"""

    def __init__(self, root_ctx: RootContext):
        self._root_ctx = root_ctx
        self._plugin_metas: dict = {}
        self._plugin_configs: dict = {}

    def bootstrap(self, config: dict, package: str = 'app.plugins',
                  plugins_dir: str = None):
        """从 dict 配置加载所有插件"""
        self._plugin_configs = config

        if plugins_dir is None:
            plugins_dir = os.path.join(
                os.path.dirname(os.path.dirname(__file__)), 'plugins'
            )

        parent_dir = os.path.dirname(os.path.dirname(plugins_dir))
        if parent_dir not in sys.path:
            sys.path.insert(0, parent_dir)

        for filename in sorted(os.listdir(plugins_dir)):
            if filename.endswith('.py') and not filename.startswith('_'):
                mod_name = f'{package}.{filename[:-3]}'
                try:
                    module = importlib.import_module(mod_name)
                    meta = extract_plugin_meta(module)
                    if meta:
                        self._plugin_metas[meta.name] = meta
                except Exception as e:
                    log.error('scan failed %s: %s', filename, e)

        enabled = {n: m for n, m in self._plugin_metas.items() if n in config}
        order = self._topo_sort(enabled)

        for name in order:
            self._load(enabled[name], config.get(name, {}))

        # 加载完毕，清除 current_loading_fiber
        self._root_ctx._current_loading_fiber = None

    def _topo_sort(self, metas: dict) -> list:
        """Kahn 算法拓扑排序"""
        provide_map = {}
        for name, meta in metas.items():
            for svc in meta.provide:
                provide_map[svc] = name

        graph = defaultdict(list)
        in_deg = {n: 0 for n in metas}

        for name, meta in metas.items():
            for dep_svc in meta.inject:
                dep = provide_map.get(dep_svc)
                if dep and dep in metas:
                    graph[dep].append(name)
                    in_deg[name] += 1

        queue = [n for n in metas if in_deg[n] == 0]
        order = []
        while queue:
            node = queue.pop(0)
            order.append(node)
            for dep in graph[node]:
                in_deg[dep] -= 1
                if in_deg[dep] == 0:
                    queue.append(dep)

        return order

    def _load(self, meta, config: dict):
        """加载单个插件"""
        name = meta.name
        fiber = Fiber(name=name, inject=meta.inject, provide=meta.provide)
        fiber._root_ctx = self._root_ctx

        proxy_ctx = self._root_ctx.create_proxy(fiber)
        fiber._proxy_ctx = proxy_ctx

        self._root_ctx.registry['fibers'].append(fiber)
        self._root_ctx.reflect._all_fibers.append(fiber)

        for dep in meta.inject:
            fiber._check_impl(dep)

        ready = all(d in fiber.store for d in meta.inject)

        if ready:
            fiber._state = FiberState.LOADING
            # ★ 设置 current_loading_fiber，让 Service.register 知道谁在调用
            self._root_ctx._current_loading_fiber = fiber
            try:
                if meta.is_service:
                    meta.plugin_obj(proxy_ctx)
                else:
                    fiber._apply_fn = lambda ctx, c=config, fn=meta.plugin_obj: fn(ctx, c)
                    meta.plugin_obj(proxy_ctx, config)
                fiber._state = FiberState.ACTIVE
            except Exception:
                fiber._state = FiberState.FAILED
                raise
            finally:
                self._root_ctx._current_loading_fiber = None
        else:
            if meta.is_service:
                fiber._apply_fn = lambda ctx, cls=meta.plugin_obj: cls(ctx)
            else:
                fiber._apply_fn = lambda ctx, c=config, fn=meta.plugin_obj: fn(ctx, c)

    def unload_plugin(self, name: str) -> bool:
        """卸载指定插件（级联）"""
        for fiber in self._root_ctx.registry['fibers']:
            if fiber.name == name and fiber.state != FiberState.DISPOSED:
                fiber.unload()
                return True
        return False

    def get_fiber(self, name: str) -> Optional[Fiber]:
        """取最新的同名 fiber（跳过历史 DISPOSED 记录）"""
        for fiber in reversed(self._root_ctx.registry['fibers']):
            if fiber.name == name:
                return fiber
        return None

    def remove_fiber(self, fiber) -> None:
        """PATCH #4：从 registry['fibers'] 摘除，供 PluginManager 重建前清理"""
        fibers = self._root_ctx.registry['fibers']
        if fiber in fibers:
            fibers.remove(fiber)
