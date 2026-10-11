/**
 * M18：壳初始化（登录态相关）—— 启动时已登录、以及登录成功后共用。
 *
 * 拆成两层：
 * - loadAuthenticatedData()：阻塞式数据面（应用插件清单 + 首页偏好），
 *   必须在挂载/跳转前完成，否则 EmptyHome 找不到应用、dock 缺插件
 * - startAuthenticatedShell()：非阻塞交互面（重挂 run、会话对账、shell WS）
 */
import type { UiCtx } from '../registry/uiCtx'
import { syncAppPlugins } from '../services/pluginHost'
import { startShellSync } from '../composables/useShellSync'
import { useChat } from './chat/useChat'
import { reloadHomeApp } from './settings/useHomeApp'

let uiCtx: UiCtx | null = null

export function setShellUiCtx(ctx: UiCtx) {
  uiCtx = ctx
}

/** 阻塞式：加载应用插件清单与首页偏好（登录后才能拿到） */
export async function loadAuthenticatedData(): Promise<void> {
  if (!uiCtx) return
  await syncAppPlugins(uiCtx)
  await reloadHomeApp()
}

/** 非阻塞：重挂进行中的 run、会话对账、建立 shell WS 同步 */
export function startAuthenticatedShell() {
  const { restoreRuns, refreshSessions } = useChat()
  // 刷新/PWA 重启后无论落在哪个页面，都重挂服务端仍在执行的 run（M17）
  restoreRuns()
  // M17.10：打开即对账（会话列表）+ shell 级 WS 同步（插件装卸/配置变更推送）
  refreshSessions()
  startShellSync()
}
