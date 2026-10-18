/**
 * pluginHost —— 应用插件的动态加载宿主。
 * - kind='app'：fetch /api/apps → import(entry) → setup(uiCtx)
 * - kind='page'（M11）：静态页应用，无需 setup——注册通用 WebViewPage 并指向静态入口
 * 已加载的 id 记录去重；卸载 = unregisterApp（刷新后彻底干净）。
 */
import type { UiCtx } from '../registry/uiCtx'
import { isLucideIconName, registry } from '../registry/appRegistry'
import WebViewPage from '../components/WebViewPage.vue'
import { api } from './api'

const loadedIds = new Set<string>()
const teardowns = new Map<string, () => void>()
let _uiCtx: UiCtx | null = null

/**
 * 插件自带样式（/plugin-dist/<id>/index.css）：插入 <link> 并等它生效再加载模块，
 * 避免首帧「无样式 → 尺寸为 0」的闪断。同 URL 只插一次（syncInstalled 会重复触发）。
 * 样式失败不判插件失败——只警告；3s 超时兜底，网络抖动不阻塞启动。
 */
const styleLoads = new Map<string, { promise: Promise<void>; link: HTMLLinkElement }>()
/** appId → 样式 URL（卸载时据此摘掉 <link>） */
const appStyles = new Map<string, string>()

function ensureAppStyle(href: string): Promise<void> {
  const cached = styleLoads.get(href)
  if (cached) return cached.promise
  const link = document.createElement('link')
  const load = new Promise<void>((resolve) => {
    link.rel = 'stylesheet'
    link.href = href
    link.dataset.pluginStyle = '1'
    link.onload = () => resolve()
    link.onerror = () => {
      console.warn(`插件样式加载失败: ${href}`)
      resolve()
    }
  })
  document.head.appendChild(link)
  const timed = Promise.race([
    load,
    new Promise<void>((resolve) => setTimeout(resolve, 3000)),
  ])
  styleLoads.set(href, { promise: timed, link })
  return timed
}

/** 卸载插件时摘掉它的样式表，避免重装后新旧两份 CSS 并存 */
function removeAppStyle(href: string) {
  const rec = styleLoads.get(href)
  if (!rec) return
  rec.link.remove()
  styleLoads.delete(href)
}

/** page 类应用：用内核 WebViewPage 包裹静态入口 */
function registerPageApp(uiCtx: UiCtx, app: {
  id: string; title: string; icon: string;
  route: string; entry: string; dock_order: number;
}): void {
  const { defineComponent, h } = uiCtx.vue
  const Page = defineComponent({
    name: `page:${app.id}`,
    setup: () => () => h(WebViewPage, { entry: app.entry, title: app.title }),
  })
  uiCtx.registerApp({
    id: app.id, title: app.title, icon: app.icon,
    route: app.route, order: app.dock_order, component: Page,
    fullscreen: true,
  })
}

export interface SyncResult {
  /** 本次新加载出来的应用标题（用于提示「已加载新插件」） */
  loaded: string[]
  failed: string[]
}

/** 同步已安装应用：加载未加载过的插件（安装后调用可增量生效） */
export async function syncAppPlugins(uiCtx: UiCtx): Promise<SyncResult> {
  _uiCtx = uiCtx
  const loaded: string[] = []
  const failed: string[] = []
  let apps
  try {
    apps = await api.apps()
  } catch (e) {
    console.error('获取应用清单失败（后端离线？）', e)
    return { loaded, failed: ['__apps_fetch_failed__'] }
  }
  for (const app of apps) {
    if (loadedIds.has(app.id)) continue
    try {
      if (app.kind === 'page') {
        registerPageApp(uiCtx, app)        // M11：静态页应用
      } else {
        // 先上样式再上代码：插件自带的工具类必须在首帧就位（漏了就是 0×0 的空元素）
        if (app.style) {
          appStyles.set(app.id, app.style)
          await ensureAppStyle(app.style)
        }
        const mod = await import(/* @vite-ignore */ app.entry)
        const lifecycle = await mod.setup(uiCtx)
        // 图标以 plugin.json 为准：插件 registerApp 里写的是另一份副本，不覆盖就会出现
        // 「改了清单、dock 不变」。两种插件自定义例外，清单字符串无法表达，保留插件的：
        // 1) 插件注册的是自绘组件（emoji/SVG）；2) 清单值不是合法 lucide 名（如 🍅）
        const ownIcon = registry.byId(app.id)?.icon
        if (
          app.icon && typeof ownIcon === 'string'
          && ownIcon !== app.icon && isLucideIconName(app.icon)
        ) {
          registry.setIcon(app.id, app.icon)
        }
        if (typeof lifecycle?.teardown === 'function') {
          teardowns.set(app.id, () => lifecycle.teardown())
        }
      }
      loadedIds.add(app.id)
      loaded.push(app.title || app.id)
    } catch (e) {
      console.error(`插件 ${app.id} 前端加载失败`, e)
      failed.push(app.id)
    }
  }
  return { loaded, failed }
}

export function unloadApp(appId: string) {
  loadedIds.delete(appId)
  const teardown = teardowns.get(appId)
  teardowns.delete(appId)
  try { teardown?.() } catch (e) { console.error(`插件 ${appId} teardown 失败`, e) }
  _uiCtx?.unregisterApp(appId)
  const styleHref = appStyles.get(appId)
  if (styleHref) {
    appStyles.delete(appId)
    removeAppStyle(styleHref)
  }
}

/** 安装后增量加载新应用（不重载已加载的） */
export async function syncInstalled(): Promise<SyncResult> {
  if (!_uiCtx) return { loaded: [], failed: [] }
  return syncAppPlugins(_uiCtx)
}

export function isLoaded(appId: string): boolean {
  return loadedIds.has(appId)
}
