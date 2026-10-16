import type { RouteLocationRaw, Router } from 'vue-router'
import { registry } from '../registry/appRegistry'
import { NAV_ACTION } from '../router/appHistory'

export interface BackHandler {
  appId: string
  canGoBack: () => boolean
  back: () => void | Promise<void>
  /** 同一应用内，弹层应高于页面（默认 0）。 */
  priority?: number
}

export interface AppNavigation {
  switchApp: (appId: string) => Promise<void>
  push: (to: RouteLocationRaw) => Promise<void>
  replace: (to: RouteLocationRaw) => Promise<void>
  back: () => Promise<boolean>
  register: (handler: BackHandler) => () => void
  registerOverlay: (handler: Omit<BackHandler, 'appId'>) => () => void
  setHash: (appId: string, hash: string) => Promise<void>
  /** 宿主卸载应用时清理栈与处理器。 */
  removeApp: (appId: string) => void
}

let navigation: AppNavigation | null = null
export function useAppNavigation(): AppNavigation {
  if (!navigation) throw new Error('Anka navigation 尚未初始化')
  return navigation
}

/** 壳层单例：切应用保留各自位置，内部路由另存栈；原生 Back 只交给当前应用。 */
export function createAppNavigation(router: Router) {
  const stacks = new Map<string, string[]>()
  const handlers = new Set<BackHandler>()
  const overlays = new Set<Omit<BackHandler, 'appId'>>()
  let backing = false
  const appId = () => router.currentRoute.value.meta.appId as string | undefined

  router.afterEach((to, from, failure) => {
    if (failure) return
    const id = to.meta.appId as string | undefined
    if (!id) return
    const stack = stacks.get(id) ?? []
    if (stack[stack.length - 1] === to.fullPath) return
    if (from.meta.appId !== id) {
      // 显式跨应用深链从该位置开始；switchApp 会使用已有栈顶，不走这里。
      stacks.set(id, [to.fullPath])
    } else {
      if (router.options.history.state[NAV_ACTION] === 'push' || !stack.length) {
        stack.push(to.fullPath)
      } else if (stack[stack.length - 2] === to.fullPath) stack.pop()
      else stack[stack.length - 1] = to.fullPath
      stacks.set(id, stack)
    }
  })

  async function back(): Promise<boolean> {
    if (backing) return false
    backing = true
    try {
      const candidates = [...overlays].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
      const local = [...handlers].filter(h => h.appId === appId())
        .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
      for (const h of [...candidates, ...local]) {
        if (h.canGoBack()) { await h.back(); return true }
      }
      const stack = stacks.get(appId() ?? '')
      if (!stack || stack.length <= 1) return false
      const current = stack.pop()!
      try {
        const failure = await router.replace(stack[stack.length - 1])
        if (failure) { stack.push(current); return false }
      } catch (e) { stack.push(current); throw e }
      return true
    } finally { backing = false }
  }

  navigation = {
    async switchApp(id) {
      const app = registry.byId(id)
      if (!app) throw new Error(`应用 ${id} 未注册`)
      if (appId() === id) return
      const stack = stacks.get(id)
      await router.replace(stack?.[stack.length - 1] ?? app.route.replace(/\/:.*$/, ''))
    },
    async push(to) { await router.push(to) },
    async replace(to) { await router.replace(to) },
    back,
    register(handler) {
      handlers.add(handler)
      return () => { handlers.delete(handler) }
    },
    registerOverlay(handler) {
      overlays.add(handler)
      return () => { overlays.delete(handler) }
    },
    async setHash(id, hash) {
      // 后台插件不能改当前应用的 URL；location 与 Vue Router 始终保持一致。
      if (appId() !== id) return
      const route = router.currentRoute.value
      await router.replace({ path: route.path, query: route.query, hash })
    },
    removeApp(id: string) {
      stacks.delete(id)
      for (const handler of handlers) if (handler.appId === id) handlers.delete(handler)
    },
  }
  return navigation
}
