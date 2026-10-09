/**
 * M17.10：PWA 更新一致性 —— 统一更新入口与版本巡检。
 *
 * 设计（一版本 · 一动作）：
 * - 三种更新来源（sw=新 SW 就绪、front=前端已重新部署、backend=仅后端重新部署）
 *   汇流到同一个 notify/apply；apply 执行注入的动作（有新 SW 则激活，否则 reload）。
 * - startUpdateWatch 覆盖 SW 天生看不到的「仅后端发版」：
 *   切回前台 + 定时拉 /api/health 比对版本戳。
 * - 正常路径是 SW 原子切换 + reload，不做暴力清缓存（清缓存仅 main.ts 不可恢复兜底用）。
 */
import { computed, ref } from 'vue'
import { api } from '../services/api'

export type UpdateSource = 'sw' | 'front' | 'backend'

const LABEL: Record<UpdateSource, string> = {
  sw: '发现新版本',
  front: '前端已更新',
  backend: '服务端已更新',
}

/** 本页加载时注入的构建号（vite define） */
const selfBuild = __APP_BUILD__

const source = ref<UpdateSource | null>(null)
const available = computed(() => source.value !== null)
const label = computed(() => (source.value ? LABEL[source.value] : ''))

let applyFn: (() => void | Promise<void>) | null = null

/** SW 更新动作，由 main.ts 注入（updateSW(true) = skipWaiting + reload）；
 *  未注入（如无 SW 环境）时退化为整页 reload。 */
let applySwUpdate: () => void | Promise<void> = () => location.reload()

export function setSwApplyer(fn: () => void | Promise<void>) {
  applySwUpdate = fn
}

function notify(src: UpdateSource, apply: () => void | Promise<void>) {
  if (source.value) return // 已有提示，不重复弹
  applyFn = apply
  source.value = src
}

/** SW onNeedRefresh 时由 main.ts 调用 */
export function notifySwUpdate() {
  notify('sw', () => applySwUpdate())
}

export function useAppUpdate() {
  return {
    available,
    label,
    apply: async () => {
      const fn = applyFn
      applyFn = null
      source.value = null
      await fn?.()
    },
    dismiss: () => {
      applyFn = null
      source.value = null
    },
  }
}

let started = false
let primed = false
let baseApi: string | null = null

/**
 * 执行一次版本巡检，返回是否发现更新。
 * ① front_build ≠ 本页构建号 → 前端已重新部署 → 走 SW 更新流程
 * ② api_build 相对页面加载基线变化 → 仅后端重新部署 → 提示整页刷新
 */
async function runCheck(): Promise<boolean> {
  try {
    const h = await api.health()
    if (!primed) {
      primed = true
      baseApi = h.api_build ?? null
    }
    if (h.front_build && h.front_build !== selfBuild) {
      notify('front', () => applySwUpdate())
      return true
    }
    if (baseApi && h.api_build && h.api_build !== baseApi) {
      notify('backend', () => location.reload())
      return true
    }
    return false
  } catch (e) {
    // 网络异常静默，下轮重试
    console.error('[update-watch]', e)
    return false
  }
}

/** 「客户端 · 检查更新」按钮：立即巡检一次（M17.11） */
export function checkForUpdatesNow(): Promise<boolean> {
  return runCheck()
}

/**
 * 版本巡检（单例）：与 SW 的 update() 互补。
 * 切回前台 + 定时两个时机拉 /api/health 比对版本戳。
 */
export function startUpdateWatch(intervalMs = 60_000) {
  if (started) return
  started = true

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void runCheck()
  })
  window.setInterval(() => void runCheck(), intervalMs)
  void runCheck()
}
