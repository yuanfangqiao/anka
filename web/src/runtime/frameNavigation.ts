import { appRuntime } from './appRuntime'
import { useAppNavigation } from '../services/navigation'
import { watch } from 'vue'

export function frameNavigation(appId: string, notify: (route: { path: string; canGoBack: boolean }) => void) {
  const run = appRuntime.runs.get(appId)
  const raw = run?.route.query.__app
  const initial = typeof raw === 'string' ? raw : '/'
  const first = validPath(initial)
  const stack = first === '/' ? ['/'] : ['/', first]
  const current = () => ({ path: stack[stack.length - 1], canGoBack: stack.length > 1 })
  const navigation = useAppNavigation()
  async function mirror() {
    const next = current()
    notify(next)
    const active = appRuntime.runs.get(appId)
    if (!active) return next
    const query = { ...active.route.query, __app: next.path === '/' ? undefined : next.path }
    await appRuntime.route(appId, { path: active.route.path, query, hash: active.route.hash }, true)
    return next
  }
  const stop = navigation.register({ appId, canGoBack: () => stack.length > 1,
    async back() { stack.pop(); await mirror() } })
  const stopRoute = watch(() => appRuntime.runs.get(appId)?.route.query.__app, value => {
    const path = typeof value === 'string' ? validPath(value) : '/'
    if (path !== current().path) { stack.push(path); notify(current()) }
  })
  return {
    current, stop() { stop(); stopRoute() },
    async push(path: string, replace = false) {
      const next = validPath(path)
      if (replace) stack[stack.length - 1] = next
      else if (next !== current().path) stack.push(next)
      return mirror()
    },
    async back() { if (stack.length > 1) stack.pop(); return mirror() },
  }
}

function validPath(value: unknown) {
  if (typeof value !== 'string' || value.length > 4096 || !value.startsWith('/') || value.startsWith('//')) {
    throw new Error('应用内部路径必须以单个 / 开头且不超过 4096 字符')
  }
  return value
}
