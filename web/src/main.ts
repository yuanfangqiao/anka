import { createApp } from 'vue'
import { registerSW } from 'virtual:pwa-register'
import App from './App.vue'
import { createAppRouter } from './router'
import { createUiCtx } from './registry/uiCtx'
import { syncAppPlugins } from './services/pluginHost'
import { setup as setupChat } from './system/chat'
import { setup as setupSettings } from './system/settings'
import { loadAuthenticatedData, setShellUiCtx } from './system/shellBoot'
import { ensureAuthed } from './composables/useAuth'
import { autoUpdate, forceRefresh, notifySwUpdate, setSwApplyer, startUpdateWatch } from './system/useAppUpdate'
// 首行时机注册：beforeinstallprompt 只触发一次，晚导入会错过
import './system/useInstallPrompt'
import './styles/tokens.css'
import './styles/base.css'

let swRegistration: ServiceWorkerRegistration | null = null

// 开发模式：注销历史上 dev SW 留下的注册与缓存（旧 SW 会用过期模块响应新页面，导致切换页面白屏）
if (import.meta.env.DEV) {
  navigator.serviceWorker
    ?.getRegistrations()
    .then((rs) => rs.forEach((r) => r.unregister()))
    .catch(console.error)
  globalThis.caches
    ?.keys()
    .then((ks) => ks.forEach((k) => caches.delete(k)))
    .catch(console.error)
} else {
  // M17.10：单点手动注册（injectRegister: null），拿住 registration 以便主动触发更新检查
  let autoApply = false
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      // 用户已点过「更新」（autoApply）→ 就绪即应用；否则弹横幅等确认
      if (autoApply) {
        void updateSW(true)
      } else {
        notifySwUpdate()
      }
    },
    onOfflineReady() {},
    onRegisteredSW(_url, registration) {
      swRegistration = registration ?? null
    },
  })
  setSwApplyer(async () => {
    // front_build 信号可能比 SW 发现新版本先到：先强制检查一次，
    // 就绪后由 onNeedRefresh + autoApply 自动应用；超时兜底整页刷新。
    autoApply = true
    await swRegistration?.update()
    await updateSW(true)
    window.setTimeout(() => {
      if (autoApply) location.reload()
    }, 4000)
  })

  // M17.10 不可恢复兜底（对齐 Angular SwUpdate unrecoverable）：
  // 部署后旧 hash chunk 已被服务器删除时，vite 动态 import 触发 preloadError，
  // 页面处于不可恢复态 → 无条件清缓存 + 注销 SW + 强制 reload 救活，不问用户。
  window.addEventListener('vite:preloadError', (e) => {
    e.preventDefault()
    void forceRefresh()
  })

  // 关键：移动端 PWA 从后台切回不会重载页面，SW 永远没机会检查更新。
  // 「切回前台」+「定时」两个时机主动 update()，是修复不刷新的核心。
  // M17.13：受「自动检查更新」本地偏好约束（默认关；手动「检查更新」不受限）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && autoUpdate.value) void swRegistration?.update()
  })
  window.setInterval(() => {
    if (autoUpdate.value) void swRegistration?.update()
  }, 60_000)
}

async function bootstrap() {
  // M18：先探测登录态（与其余 setup 并行）；未登录不发起业务预取，避免 401 风暴
  const authed = ensureAuthed()

  const router = createAppRouter()
  const uiCtx = createUiCtx(router)
  setShellUiCtx(uiCtx)

  // 系统插件（静态捆入）与应用插件（动态 import）走同一 uiCtx
  setupChat(uiCtx)
  setupSettings(uiCtx)

  if (await authed) {
    // M18：已登录 → 加载应用插件清单与首页偏好（挂载前完成，
    // 否则 EmptyHome 找不到应用、dock 缺插件）
    await loadAuthenticatedData()
  } else {
    // M18：已在 /login 却走到这里 → 说明登录页没被后端直出（dev 缺代理、
    // 或后端没起）。此时若再跳一次，redirect 参数会 `%2F` 逐层嵌套成死循环，
    // 故只报错不跳转。
    if (location.pathname === '/login') {
      console.error('[auth] /login 未被后端直出：检查 Vite 代理与后端进程')
      return
    }
    // 未登录 → 整页跳后端直出的登录页（不挂载应用壳，避免闪一下空壳）
    const back = encodeURIComponent(location.pathname + location.search)
    location.replace(`/login?redirect=${back}`)
    return
  }

  // M17.10：版本巡检仅生产启用（dev 无 SW，且 dist 可能是旧构建会误报）
  if (import.meta.env.PROD) startUpdateWatch()

  createApp(App).use(router).mount('#app')
}

bootstrap()
