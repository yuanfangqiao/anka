"""Installed plugin startup, called by PluginManager under the kernel lock."""
import logging

from . import plugin_builder, settings
from .startup_trace import phase

log = logging.getLogger('agentos.plugins')


def bootstrap(manager, config: dict, package: str, plugins_dir=None) -> None:
    with phase('infra 插件初始化'):
        manager.loader.bootstrap(config, package=package, plugins_dir=plugins_dir)
    with phase('读取安装记录与扫描插件目录'):
        installed = manager.service.installed_ids()
        manifests = manager.discover()
    log.info('[startup] 已安装插件=%d，扫描发现=%d，开发模式=%s',
             len(installed), len(manifests), settings.AGENT_DEV)
    for app_id in installed:
        manifest = manifests.get(app_id)
        if manifest is None or not manifest.ok:
            log.warning('[startup] 跳过插件 %s：%s', app_id,
                        '目录缺失' if manifest is None else '清单校验失败')
            continue
        if manifest.page:
            log.info('[startup] 插件 %s：静态页面，复用现有产物', app_id)
            continue
        with phase(f'加载 App 插件 {app_id}'):
            if manifest.build:
                entry = (manifest.build.get('output') or {}).get('entry')
                if entry and not (manifest.root / entry).is_file():
                    log.info('[startup] 插件 %s：产物缺失 %s，执行构建', app_id, entry)
                    ok, msg = plugin_builder.build_recipe(app_id, manifest)
                    if not ok:
                        log.error('插件 %s 构建失败: %s', app_id, msg)
                        continue
                else:
                    log.info('[startup] 插件 %s：复用运行时 %s，跳过构建配方',
                             app_id, entry)
            try:
                manager._install_loaded(app_id, manifest)
            except Exception:
                log.exception('安装 app 插件 %s 失败', app_id)
                continue
            if not settings.AGENT_DEV and manifest.ui_entry:
                if plugin_builder.is_stale(app_id):
                    log.info('[startup] 插件 %s：原生入口缓存过期，构建入口', app_id)
                    plugin_builder.build_web(app_id)
                else:
                    log.info('[startup] 插件 %s：复用原生入口缓存', app_id)
    log.info('bootstrap: %s', ', '.join(
        f'{item.name}={item.state}' for item in manager.list_plugins()))
