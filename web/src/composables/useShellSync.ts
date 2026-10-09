/**
 * M17.10：shell 级 WS 同步客户端（复用 M16 通道，房间 shell/main/__shell__）。
 *
 * 职责：
 * - 运行时变化（插件装卸、配置/模型变更）由服务器广播 → 局部刷新，不整页 reload
 * - 断线指数退避自动重连；重连成功 = 一次对账（插件清单 → 配置 → 会话 → runs）
 * - 协议心跳 ping/pong（sync_api 协议自带）
 */
import { ref } from 'vue'
import { api } from '../services/api'
import { syncInstalled, unloadApp } from '../services/pluginHost'
import { useChat } from '../system/chat/useChat'
import { reloadHomeApp } from '../system/settings/useHomeApp'

/** 壳层配置共享态（/api/config；settings 变更后重拉，DockBar 等消费） */
export const shellConfig = ref<Record<string, number>>({})

let ws: WebSocket | null = null
let started = false
let retry = 0

async function refreshConfig() {
  try {
    shellConfig.value = await api.config()
  } catch (e) {
    console.error('[shell-sync] config 拉取失败', e)
  }
}

/** 打开/重连对账：与服务器收敛到最新状态 */
async function rehydrate() {
  const { refreshSessions, restoreRuns } = useChat()
  try {
    await syncInstalled()
    await refreshConfig()
    await refreshSessions()
    await restoreRuns()
  } catch (e) {
    console.error('[shell-sync] rehydrate 失败', e)
  }
}

interface ShellEvent {
  type: string
  action?: string
  name?: string
}

function onEvent(msg: ShellEvent) {
  const { refreshSessions, loadModels } = useChat()
  if (msg.type === 'plugins-changed') {
    // 卸载要对称处理：先移除本地已加载实例，再增量同步清单
    if (msg.action === 'uninstall' && msg.name) unloadApp(msg.name)
    void syncInstalled()
    void refreshSessions()
  } else if (msg.type === 'settings-changed') {
    void refreshConfig()
    void loadModels()
    void reloadHomeApp()          // M17.12：首页偏好与其他终端同步
  }
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(
    `${proto}://${location.host}/api/sync/ws/main?app=shell&file=__shell__`)
  ws.onopen = () => {
    retry = 0
    void rehydrate()
  }
  ws.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data as string) as ShellEvent)
    } catch (err) {
      console.error('[shell-sync] 消息解析失败', err)
    }
  }
  ws.onclose = () => {
    ws = null
    const delay = Math.min(30_000, 1000 * 2 ** retry++)
    window.setTimeout(connect, delay)
  }
  ws.onerror = () => ws?.close()
}

/** 启动 shell 同步（单例；App.vue onMounted 调一次） */
export function startShellSync() {
  if (started) return
  started = true
  connect()
  window.setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }))
    }
  }, 25_000)
}
