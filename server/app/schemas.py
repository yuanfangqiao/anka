"""Pydantic 视图模型 —— 与前端 services/api.ts 的契约"""

from pydantic import BaseModel


class Health(BaseModel):
    status: str
    plugins_total: int
    plugins_active: int
    # M17.10 新增（只增不改，向后兼容）：PWA 版本巡检
    front_build: str | None = None   # 当前伺服的前端构建号（dist/version.json）
    api_build: str | None = None     # 后端自身构建号（git sha）


class PluginInfo(BaseModel):
    name: str
    state: str            # PENDING/LOADING/ACTIVE/FAILED/DISPOSED/UNLOADING
    inject: list[str]
    provide: list[str]
    is_service: bool
    effects: int
    # M6 新增（只增不改，向后兼容）
    system: bool = False          # 系统插件（可禁用不可卸载）
    source: str = 'infra'         # infra | app（system 插件不走 cordis，不进本列表）
    has_ui: bool = False
    requires_restart: bool = False


class AvailablePlugin(BaseModel):
    """可安装：扫描 plugins/ 目录发现但尚未安装"""
    id: str
    name: str
    version: str
    icon: str
    description: str = ''
    errors: list[str] = []


class InstallResult(BaseModel):
    name: str
    ok: bool
    state: str = ''
    requires_restart: bool = False
    message: str | None = None


class AppInfo(BaseModel):
    """GET /api/apps —— 前端宿主加载清单（仅已安装的 app 插件）"""
    id: str
    title: str
    icon: str
    route: str
    entry: str                      # app: 编译产物/源码入口；page: 静态页入口
    dock_order: int
    has_sidebar: bool
    kind: str = 'app'               # M11：app（setup(uiCtx)）| page（iframe 静态页）


class AppCallRequest(BaseModel):
    method: str
    args: dict = {}


class PluginActionResult(BaseModel):
    name: str
    ok: bool
    state: str
    cascaded: list[str] = []
    message: str | None = None


class ChatRequest(BaseModel):
    message: str
    model: str = 'default'
    max_turns: int = 100              # 插件开发类任务需要多轮工具调用（M16：5→20→100）
    session_id: str | None = None     # M15：多会话（缺省则新建）
    images: list[str] = []            # M17.9：随消息发送的图片（data URL，支持多张，vision）


class ChatStarted(BaseModel):
    """POST /api/chat 的响应（M17）：run 已启动，事件走 /api/runs/{id}/stream"""
    run_id: str
    session_id: str


class RunInfo(BaseModel):
    """GET /api/runs —— run 摘要（活动 run 可供页面刷新后重挂）"""
    id: str
    session_id: str
    preview: str
    model: str
    active: bool
    created_at: float


class SessionSummary(BaseModel):
    """GET /api/sessions —— 会话摘要"""
    id: str
    title: str
    updated_at: float
    count: int = 0


class ChatMessage(BaseModel):
    """会话历史气泡（user/assistant + 工具卡）"""
    role: str
    text: str = ''
    tools: list[dict] = []
    images: list[str] = []            # M17.9：用户消息附带的图片（data URL，支持多张）


class SessionDetail(BaseModel):
    id: str
    title: str
    messages: list[ChatMessage]


class ModelInfo(BaseModel):
    """TokenHub 模型清单项（M13）"""
    id: str
    name: str


class SettingsPayload(BaseModel):
    """POST /api/settings —— 只写：api_key 或 default_model"""
    api_key: str | None = None
    default_model: str | None = None


class SettingsView(BaseModel):
    """GET /api/settings —— 脱敏视图（绝不回传完整 Key）"""
    models: list[ModelInfo]
    default_model: str
    base_url: str
    has_key: bool
    api_key_masked: str | None = None


class ErrorBody(BaseModel):
    error: str
    message: str
