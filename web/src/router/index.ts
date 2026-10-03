import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

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
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export function createAppRouter() {
  return createRouter({
    history: createWebHistory(),
    routes,
  })
}

export default createAppRouter
