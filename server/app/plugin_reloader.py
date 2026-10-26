"""Plugin reload transaction and rollback; invoked under the kernel locks."""
import logging
import shutil
import time

from . import folder_loader, settings
from .cordis import FiberState
from .schemas import PluginActionResult

log = logging.getLogger('agentos.plugin_reloader')


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

