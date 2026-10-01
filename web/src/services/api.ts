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
}
