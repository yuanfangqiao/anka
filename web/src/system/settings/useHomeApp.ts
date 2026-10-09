/**
 * M17.12：首页应用偏好（后端 settings.json 存储，随 settings-changed WS 广播多端同步）。
 *
 * 模块级单例：EmptyHome 启动解析与 HomeSection 面板共用同一份状态，避免各处重复请求。
 * 存储语义：字符串 = 应用 id；'' / null = 未设置（跟随默认 → 对话）。
 */
import { ref } from 'vue'
import { useToast } from '../../composables/useToast'
import { api } from '../../services/api'

const toast = useToast()

export const homeApp = ref<string | null>(null)
let loading: Promise<void> | null = null

/** 首次调用拉取一次，后续复用同一 Promise（幂等单例） */
export function ensureHomeApp(): Promise<void> {
  loading ??= api
    .settings()
    .then((s) => {
      homeApp.value = s.home_app || null
    })
    .catch(() => {
      // 后端离线：降级为未设置，不阻塞启动
      homeApp.value = null
    })
  return loading
}

/** 强制重拉（M17.10 settings-changed 事件到达时调用） */
export async function reloadHomeApp(): Promise<void> {
  loading = null
  await ensureHomeApp()
}

/** 保存偏好；null = 清除（跟随默认）。乐观更新，失败回滚 */
export async function setHomeApp(id: string | null, label?: string): Promise<void> {
  const prev = homeApp.value
  homeApp.value = id
  try {
    await api.saveSettings({ home_app: id ?? '' })
    toast.ok(label ? `首页已设为「${label}」` : '首页已恢复默认')
  } catch (e) {
    homeApp.value = prev
    toast.err(`保存失败：${(e as Error).message}`)
  }
}

export function useHomeApp() {
  return { homeApp, ensureHomeApp, reloadHomeApp, setHomeApp }
}
