import { createRouter, type RouteRecordRaw } from 'vue-router'
import { ensureAuthed } from '../composables/useAuth'
import { createAppHistory } from './appHistory'
import { createAppNavigation } from '../services/navigation'

/**
 * M6：路由分两类——
 * - 内核静态路由：'/' 空态门（有应用则跳首个 dock 应用）+ catch-all
 * - 插件路由：系统/应用插件经 uiCtx.registerApp 运行时 addRoute
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('../components/EmptyHome.vue'),
    // 空态首页也是整页内容，不套空 TopBar
    meta: { title: '首页', fullscreen: true },
  },
  // M17.11：插件管理已并入控制台，旧路由重定向
  { path: '/plugins-manager', redirect: '/settings/plugins' },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export function createAppRouter() {
  const appHistory = createAppHistory()
  const router = createRouter({
    history: appHistory.history,
    routes,
  })
  const navigation = createAppNavigation(router)
  // M18：登录守卫——未登录整页跳后端登录页（登录不在 SPA 内进行，避免路由竞态）
  router.beforeEach(async (to) => {
    if (await ensureAuthed()) return true
    const redirect = encodeURIComponent(to.fullPath)
    window.location.replace(`/login?redirect=${redirect}`)
    return false
  })
  router.afterEach((to, from, failure) => {
    if (!failure && to.meta.appId !== from.meta.appId) appHistory.alignBoundary()
  })
  // 初始路由完成后再建立同文档返回边界，保留深链与登录守卫语义。
  void router.isReady().then(() => appHistory.start(() => {
    void navigation.back().catch(e => console.error('[navigation] back', e))
  }))
  return router
}

export default createAppRouter
