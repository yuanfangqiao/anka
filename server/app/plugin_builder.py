"""
PluginBuilder —— 应用插件前端的「安装时编译」（M9）。

调用 web/scripts/build-plugin.mjs（vite 程序化构建，内部 esbuild）：
插件 web/ 内 .vue/.ts/.js → 单文件 ESM，缓存到 <根>/.plugin-dist/<id>/index.js，
由 FastAPI 挂载为 /plugin-dist 伺服。'vue' 保持 external，
经宿主 import map 解析到共享实例（防双 Vue）。

开发态（run_dev.py 非 --prod → AGENTOS_DEV=1）不构建：
插件源码由 vite 中间件按需编译并直接伺服。
"""

import logging
import subprocess

from . import settings

log = logging.getLogger('agentos.plugin_builder')


def has_dist(app_id: str) -> bool:
    return (settings.PLUGIN_DIST_DIR / app_id / 'index.js').is_file()


def build_web(app_id: str) -> bool:
    script = settings.WEB_DIR / 'scripts' / 'build-plugin.mjs'
    if not script.is_file():
        log.warning('构建脚本不存在，跳过 %s 前端构建: %s', app_id, script)
        return False
    try:
        r = subprocess.run(
            ['node', str(script), app_id],
            cwd=settings.WEB_DIR, capture_output=True, text=True, timeout=180)
    except Exception as e:
        log.error('插件 %s 前端构建失败: %s', app_id, e)
        return False
    if r.returncode != 0:
        log.error('插件 %s 前端构建失败:\n%s', app_id, (r.stderr or r.stdout)[-2000:])
        return False
    log.info('插件 %s 前端已构建: %s', app_id,
             settings.PLUGIN_DIST_DIR / app_id / 'index.js')
    return True
