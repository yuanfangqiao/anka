import { createApp } from 'vue'
import { registerSW } from 'virtual:pwa-register'
import App from './App.vue'
import { createAppRouter } from './router'
import { createUiCtx } from './registry/uiCtx'
import { syncAppPlugins } from './services/pluginHost'
import { setup as setupChat } from './system/chat'
import { setup as setupSettings } from './system/settings'
import { ensureHomeApp } from './system/settings/useHomeApp'
import { autoUpdate, forceRefresh, notifySwUpdate, setSwApplyer, startUpdateWatch } from './system/useAppUpdate'
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
  // M17.12.1：首页偏好与 syncAppPlugins 并行预取——
  // 不让 /api/settings 网络往返卡在 EmptyHome 的跳转关键路径上（移动端 1~3s 白等）
  void ensureHomeApp()

  const router = createAppRouter()
  const uiCtx = createUiCtx(router)

  // 系统插件（静态捆入）与应用插件（动态 import）走同一 uiCtx
  setupChat(uiCtx)
  setupSettings(uiCtx)
  await syncAppPlugins(uiCtx)

  // M17.10：版本巡检仅生产启用（dev 无 SW，且 dist 可能是旧构建会误报）
  if (import.meta.env.PROD) startUpdateWatch()

  createApp(App).use(router).mount('#app')
}

bootstrap()
