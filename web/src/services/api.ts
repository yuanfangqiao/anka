export interface Health {
  status: string
  plugins_total: number
  plugins_active: number
}

export interface PluginInfo {
  name: string
  state: string
  inject: string[]
  provide: string[]
  is_service: boolean
  effects: number
  system?: boolean
  source?: 'infra' | 'app'
  has_ui?: boolean
  requires_restart?: boolean
}

export interface AvailablePlugin {
  id: string
  name: string
  version: string
  icon: string
  description: string
  errors: string[]
}

export interface InstallResult {
  name: string
  ok: boolean
  state: string
  requires_restart: boolean
  message?: string
}

export interface AppInfo {
  id: string
  title: string
  icon: string
  route: string
  entry: string
  dock_order: number
  has_sidebar: boolean
  kind?: 'app' | 'page'      // M11：page = 静态页 iframe 应用（无需 setup）
}

export interface PluginActionResult {
  name: string
  ok: boolean
  state: string
  cascaded: string[]
  message?: string
}

export interface ModelInfo {
  id: string
  name: string
}

export interface SettingsView {
  models: ModelInfo[]
  default_model: string
  base_url: string
  has_key: boolean
  api_key_masked?: string | null
}

export interface ConnectionTest {
  ok: boolean
  model?: string
  sample?: string
  error?: string
}

// M15：多会话（由 append-only 会话日志投影）
export interface ToolCard {
  name: string
  args: Record<string, unknown>
  result: string
}

export interface SessionSummary {
  id: string
  title: string
  updated_at: number
  count: number
}

export interface SessionMessage {
  role: string
  text: string
  tools: ToolCard[]
  image?: string | null      // M17：用户消息附带的截屏（data URL）
}

export interface SessionDetail {
  id: string
  title: string
  messages: SessionMessage[]
}

// M17：对话 run（服务端常驻执行，断连不取消，可重放续传）
export interface ChatStarted {
  run_id: string
  session_id: string
}

export interface RunInfo {
  id: string
  session_id: string
  preview: string
  model: string
  active: boolean
  created_at: number
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
  } catch (e) {
    console.error('api network error', e)
    throw new ApiError('无法连接后端（M2 后可用）', 0)
  }
  if (!res.ok) {
    console.error('api http error', res.status)
    // 优先透出后端 detail.message（插件业务校验信息）
    let detail = ''
    try {
      const body = await res.json()
      detail = body?.detail?.message ?? ''
    } catch { /* 非 JSON 响应 */ }
    throw new ApiError(detail || `请求失败（HTTP ${res.status}）`, res.status)
  }
  return (await res.json()) as T
}

export const api = {
  health: () => request<Health>('/api/health'),
  // 壳层配置（内核所有，如 mobile_dock_max）
  config: () => request<Record<string, number>>('/api/config'),
  plugins: () => request<PluginInfo[]>('/api/plugins'),
  enablePlugin: (name: string) =>
    request<PluginActionResult>(`/api/plugins/${encodeURIComponent(name)}/enable`, { method: 'POST' }),
  disablePlugin: (name: string) =>
    request<PluginActionResult>(`/api/plugins/${encodeURIComponent(name)}/disable`, { method: 'POST' }),
  // M6：App 插件
  availablePlugins: () => request<AvailablePlugin[]>('/api/plugins/available'),
  installPlugin: (name: string) =>
    request<InstallResult>(`/api/plugins/${encodeURIComponent(name)}/install`, { method: 'POST' }),
  uninstallPlugin: (name: string) =>
    request<PluginActionResult>(`/api/plugins/${encodeURIComponent(name)}/uninstall`, { method: 'POST' }),
  apps: () => request<AppInfo[]>('/api/apps'),
  getAppState: (id: string) =>
    request<Record<string, unknown>>(`/api/apps/${encodeURIComponent(id)}/state`),
  callApp: (id: string, method: string, args: Record<string, unknown> = {}) =>
    request<{ ok: boolean; result: unknown }>(`/api/apps/${encodeURIComponent(id)}/call`, {
      method: 'POST',
      body: JSON.stringify({ method, args }),
    }),
  // M13：TokenHub 模型服务
  settings: () => request<SettingsView>('/api/settings'),
  saveSettings: (payload: { api_key?: string; default_model?: string }) =>
    request<SettingsView>('/api/settings', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  testConnection: (payload: { default_model?: string } = {}) =>
    request<ConnectionTest>('/api/settings/test', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  // M15：会话管理
  sessions: () => request<SessionSummary[]>('/api/sessions'),
  sessionMessages: (id: string) =>
    request<SessionDetail>(`/api/sessions/${encodeURIComponent(id)}`),
  deleteSession: (id: string) =>
    request<{ ok: boolean }>(`/api/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  // M17：对话 run（启动与事件流分离；断连不取消，stop 才终止）
  startChat: (payload: {
    message: string
    model?: string
    session_id?: string
    image?: string
  }) =>
    request<ChatStarted>('/api/chat', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  runs: () => request<RunInfo[]>('/api/runs'),
  stopRun: (id: string) =>
    request<{ ok: boolean }>(`/api/runs/${encodeURIComponent(id)}/stop`, {
      method: 'POST',
    }),
}
