import { createApp } from 'vue'
import { registerSW } from 'virtual:pwa-register'
import App from './App.vue'
import { createAppRouter } from './router'
import { createUiCtx } from './registry/uiCtx'
import { syncAppPlugins } from './services/pluginHost'
import { setup as setupChat } from './system/chat'
import { setup as setupPluginsManager } from './system/plugins-manager'
import { setup as setupSettings } from './system/settings'
import './styles/tokens.css'
import './styles/base.css'

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
  registerSW({ immediate: true })
}

async function bootstrap() {
  const router = createAppRouter()
  const uiCtx = createUiCtx(router)

  // 系统插件（静态捆入）与应用插件（动态 import）走同一 uiCtx
  setupChat(uiCtx)
  setupPluginsManager(uiCtx)
  setupSettings(uiCtx)
  await syncAppPlugins(uiCtx)

  createApp(App).use(router).mount('#app')
}

bootstrap()
