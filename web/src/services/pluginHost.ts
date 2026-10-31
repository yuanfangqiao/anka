/** Catalog discovery is cheap; plugin setup runs only on demand or explicit pre-execution. */
import type { UiCtx } from '../registry/uiCtx'
import { registry } from '../registry/appRegistry'
import WebViewPage from '../components/WebViewPage.vue'
import { api, type AppInfo } from './api'
import { appRuntime } from '../runtime/appRuntime'
import { disposeOwner } from '../runtime/channels'
import { ensureAppStyle, removeAppStyle } from '../runtime/pluginStyles'
import { cancelPreloads, schedulePreloads } from '../runtime/preload'
import { shallowReactive } from 'vue'

interface PluginRecord {
  info: AppInfo
  alive: boolean
  done: boolean
  loading?: Promise<void>
  teardown?: () => void
}
const records = new Map<string, PluginRecord>()
let host: UiCtx | null = null
const Pending = { render: () => null }
export interface SyncResult { loaded: string[]; failed: string[] }

function register(record: PluginRecord) {
  const app = record.info
  const ctx = host!
  if (app.kind === 'page') {
    const Page = ctx.vue.defineComponent({
      name: `page:${app.id}`,
      setup: () => () => ctx.vue.h(WebViewPage, { entry: app.entry, title: app.title, appId: app.id }),
    })
    ctx.registerApp({ id: app.id, title: app.title, icon: app.icon, route: app.route,
      order: app.dock_order, component: Page, fullscreen: true, system: false, inDock: true, runtime: app.runtime })
    record.done = true
    return
  }
  ctx.registerApp({ id: app.id, title: app.title, icon: app.icon,
    // The placeholder also recognizes deep links before the plugin defines its real route.
    route: app.route.includes(':') ? app.route : app.route + '/:ankaPathMatch(.*)*',
    order: app.dock_order, component: Pending, system: false, inDock: true, runtime: app.runtime,
    load: () => ensureAppLoaded(app.id) })
}

export async function ensureAppLoaded(id: string): Promise<void> {
  const record = records.get(id)
  if (!record) {
    if (registry.byId(id)?.system) return
    throw new Error(`应用 ${id} 未安装`)
  }
  if (record.done) return
  if (record.loading) return record.loading
  const attempt = { active: true }
  let timer: ReturnType<typeof setTimeout>
  const setup = async () => {
    if (record.info.style) await ensureAppStyle(record.info.style)
    const mod = await import(/* @vite-ignore */ record.info.entry)
    if (!record.alive || !attempt.active) return
    if (typeof mod.setup !== 'function') throw new Error('插件缺少 setup(uiCtx) 入口')
    const base = host!.forApp(id, () => record.alive && attempt.active)
    const scoped = { ...base, registerApp(meta: any) {
      base.registerApp({ ...meta, runtime: { ...record.info.runtime, ...meta.runtime } })
    } }
    const result = await mod.setup(scoped)
    if (!record.alive || !attempt.active) { result?.teardown?.(); return }
    if (registry.byId(id)?.load) throw new Error('插件没有注册应用组件')
    record.teardown = typeof result?.teardown === 'function' ? () => result.teardown() : undefined
    const icon = registry.byId(id)?.icon
    if (record.info.icon && typeof icon === 'string' && registry.isLucideIconName(record.info.icon)) registry.setIcon(id, record.info.icon)
    record.done = true
  }
  record.loading = Promise.race([
    setup(),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('应用初始化超时，可重新启动')), 20000) }),
  ]).catch(error => {
    attempt.active = false
    if (record.alive) { disposeOwner(id); host?.navigation.removeApp(id); register(record) }
    throw error
  }).finally(() => { clearTimeout(timer); record.loading = undefined })
  return record.loading
}

export async function syncAppPlugins(uiCtx: UiCtx): Promise<SyncResult> {
  host = uiCtx
  appRuntime.setLoader(ensureAppLoaded)
  const loaded: string[] = []
  let apps: AppInfo[]
  try { apps = await api.apps() }
  catch (error) { console.error('[app-catalog]', error); return { loaded, failed: ['__apps_fetch_failed__'] } }
  const ids = new Set(apps.map(app => app.id))
  for (const id of records.keys()) if (!ids.has(id)) unloadApp(id)
  for (const info of apps) {
    const previous = records.get(info.id)
    if (previous) {
      // Do not destroy a running draft when the server advertises a new build.
      if (previous.info.entry !== info.entry || previous.info.style !== info.style) {
        pendingUpdates.set(info.id, info)
        if (!appRuntime.runs.has(info.id)) applyPendingUpdate(info.id)
      }
      continue
    }
    const record = { info, alive: true, done: false }
    records.set(info.id, record)
    register(record)
    loaded.push(info.title || info.id)
  }
  schedulePreloads(apps, ensureAppLoaded)
  return { loaded, failed: [] }
}

export const pendingUpdates = shallowReactive(new Map<string, AppInfo>())
export function applyPendingUpdate(id: string) {
  const info = pendingUpdates.get(id)
  if (!info) return
  unloadApp(id)
  const record = { info, alive: true, done: false }
  records.set(id, record)
  register(record)
}

export function unloadApp(id: string) {
  cancelPreloads(id)
  const record = records.get(id)
  if (!record) return
  record.alive = false
  records.delete(id)
  pendingUpdates.delete(id)
  try { record.teardown?.() } catch (error) { console.error('[app-teardown]', id, error) }
  disposeOwner(id)
  host?.unregisterApp(id)
  if (record.info.style) removeAppStyle(record.info.style)
}

export async function syncInstalled(): Promise<SyncResult> {
  return host ? syncAppPlugins(host) : { loaded: [], failed: [] }
}
export function isLoaded(id: string) { return Boolean(records.get(id)?.done) }
