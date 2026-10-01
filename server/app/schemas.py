"""Pydantic 视图模型 —— 与前端 services/api.ts 的契约"""

from pydantic import BaseModel


class Health(BaseModel):
    status: str
    plugins_total: int
    plugins_active: int


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
    max_turns: int = 5


class ErrorBody(BaseModel):
    error: str
    message: str
