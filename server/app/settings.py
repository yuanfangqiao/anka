"""服务端配置 —— 插件启用表（对应 cordis.yml）+ 端口/静态目录"""

import os
from pathlib import Path

# 插件启用表：key 为插件名，value 传给 apply(ctx, config)
# 书写顺序无所谓，Loader 按 inject/provide 拓扑排序
PLUGIN_CONFIG: dict = {
    'llm-runtime': {},
    'llm-echo': {
        'echo_prefix': '[ECHO]',
        'provider': 'echo',
    },
    'tools-runtime': {},
    'tool-bash': {},
    'agent-loop': {},
    'llm-logger': {},
}

PLUGINS_PACKAGE = 'app.plugins'

HOST = os.environ.get('HOST', '0.0.0.0')
PORT = int(os.environ.get('PORT', '8000'))

# web/dist 相对 server/app/settings.py：parents[2] = 项目根
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DIST_DIR = PROJECT_ROOT / 'web' / 'dist'

# App 插件模型（M6）
APP_PLUGINS_DIR = PROJECT_ROOT / 'plugins'            # 应用插件（前后端一体，可装卸）
SYSTEM_PLUGINS_DIR = PROJECT_ROOT / 'system-plugins'  # 系统插件标记（UI 静态捆入内核）
INSTALLED_FILE = PROJECT_ROOT / 'server' / 'data' / 'installed.json'
DEFAULT_INSTALLED = ['notes', 'explore']              # 首次运行的默认安装集

# 插件前端管线（M9）
WEB_DIR = PROJECT_ROOT / 'web'
PLUGIN_DIST_DIR = PROJECT_ROOT / '.plugin-dist'       # 插件「安装时编译」产物缓存
# 开发标记：run_dev.py（非 --prod）置 AGENTOS_DEV=1 ——
# dev 下插件源码由 vite 中间件按需编译，不做安装时构建
AGENT_DEV = os.environ.get('AGENTOS_DEV', '') == '1'

# 壳层配置（M10.4，经 GET /api/config 下发给前端）
SHELL_CONFIG = {
    'mobile_dock_max': int(os.environ.get('MOBILE_DOCK_MAX', '5')),  # 手机 dock 最多可见应用数，超出横滑
}
