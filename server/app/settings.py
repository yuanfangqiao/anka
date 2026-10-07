"""服务端配置 —— 插件启用表（对应 cordis.yml）+ 端口/静态目录"""

import json
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
    'llm-tokenhub': {},
    'tools-runtime': {},
    'tool-bash': {},
    'agent-loop': {},
    'llm-logger': {},
    'harness-tools': {},
    'harness-guard': {},
    'session-log': {},
    'sync-store': {},
    'sync-hub': {},
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

# ─── TokenHub 模型服务（M13）──────────────────────────────
# 凭据 seam：Key 只写存储 + 脱敏视图 + 每次请求解析（轮换下一请求即时生效）
DATA_DIR = PROJECT_ROOT / 'server' / 'data'
CREDENTIALS_FILE = DATA_DIR / 'credentials.json'   # API Key（不入日志、不回传明文）
USER_SETTINGS_FILE = DATA_DIR / 'settings.json'    # 用户偏好（默认模型等）

# ─── 多端同步（M16）────────────────────────────────────
# 单文件 SQLite（WAL）：快照 + op-log，支持追帧与回放
SYNC_DB = DATA_DIR / 'agentos.db'
SYNC_LOG_KEEP = 500          # op-log 保留条数，超出则压缩进快照
# 入站护栏：图片走独立上传接口，WS 只传引用（不做这条上线必炸）
SYNC_MAX_MSG = 256 * 1024    # 单条 WS 入站消息上限（字节）
SYNC_MAX_POINTS = 2000       # 单笔画点数上限

TOKENHUB_BASE_URL = os.environ.get(
    'AGENTOS_TOKENHUB_URL',
    'https://api.lkeap.cloud.tencent.com/plan/v3',
)

# 13 个模型 ID，全走同一 OpenAI 兼容端点（Bearer 认证，ID 全小写）
TOKENHUB_MODELS = [
    {'id': 'tc-code-latest', 'name': 'Auto'},
    {'id': 'deepseek-v4-flash-202605', 'name': 'DeepSeek-V4-Flash 正式版 原厂直供'},
    {'id': 'deepseek-v4-pro-202606', 'name': 'DeepSeek-V4-Pro 正式版 原厂直供'},
    {'id': 'minimax-m2.7', 'name': 'MiniMax-M2.7'},
    {'id': 'minimax-m3', 'name': 'MiniMax-M3'},
    {'id': 'glm-5', 'name': 'GLM-5'},
    {'id': 'glm-5.1', 'name': 'GLM-5.1'},
    {'id': 'glm-5.2', 'name': 'GLM-5.2'},
    {'id': 'glm-5.3', 'name': 'GLM-5.3'},
    {'id': 'glm-5.3-flash', 'name': 'GLM-5.3-Flash'},
    {'id': 'hy4-preview', 'name': 'Hy4 preview'},
    {'id': 'kimi-k2.7-code', 'name': 'Kimi K2.7 Code'},
    {'id': 'kimi-k3', 'name': 'Kimi K3'},
]

DEFAULT_MODEL = os.environ.get('AGENTOS_DEFAULT_MODEL', 'tc-code-latest')


def _model_ids() -> set[str]:
    return {m['id'] for m in TOKENHUB_MODELS}


def get_api_key() -> str | None:
    """凭据解析：env 优先，credentials.json 兜底。每次请求调用，轮换即时生效。"""
    env = os.environ.get('AGENTOS_TOKENHUB_KEY')
    if env:
        return env
    try:
        data = json.loads(CREDENTIALS_FILE.read_text(encoding='utf-8'))
        return data.get('tokenhub_api_key') or None
    except Exception:
        return None


def set_api_key(value: str) -> None:
    """只写存储（不回读），写入独立凭据文件。"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    CREDENTIALS_FILE.write_text(
        json.dumps({'tokenhub_api_key': value}, ensure_ascii=False),
        encoding='utf-8')


def masked_api_key() -> str | None:
    """脱敏视图：只暴露 sk-tp-**** 形态，绝不回传完整 Key。"""
    key = get_api_key()
    if not key:
        return None
    if len(key) <= 8:
        return '****'
    return f'{key[:6]}...{key[-4:]}'


def load_user_settings() -> dict:
    try:
        return json.loads(USER_SETTINGS_FILE.read_text(encoding='utf-8'))
    except Exception:
        return {}


def save_user_settings(data: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    USER_SETTINGS_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')


def get_default_model() -> str:
    """默认模型：settings.json 持久偏好 → env → 常量兜底（校验 ID 合法）。"""
    preferred = load_user_settings().get('default_model')
    if preferred in _model_ids():
        return preferred
    return DEFAULT_MODEL
