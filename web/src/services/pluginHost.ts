/**
 * pluginHost —— 应用插件的动态加载宿主。
 * - kind='app'：fetch /api/apps → import(entry) → setup(uiCtx)
 * - kind='page'（M11）：静态页应用，无需 setup——注册通用 WebViewPage 并指向静态入口
 * 已加载的 id 记录去重；卸载 = unregisterApp（刷新后彻底干净）。
 */
import type { UiCtx } from '../registry/uiCtx'
import WebViewPage from '../components/WebViewPage.vue'
import { api } from './api'

const loadedIds = new Set<string>()
let _uiCtx: UiCtx | null = null

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
  })
}

/** 同步已安装应用：加载未加载过的插件（安装后调用可增量生效） */
export async function syncAppPlugins(uiCtx: UiCtx): Promise<string[]> {
  _uiCtx = uiCtx
  const failed: string[] = []
  let apps
  try {
    apps = await api.apps()
  } catch (e) {
    console.error('获取应用清单失败（后端离线？）', e)
    return ['__apps_fetch_failed__']
  }
  for (const app of apps) {
    if (loadedIds.has(app.id)) continue
    try {
      if (app.kind === 'page') {
        registerPageApp(uiCtx, app)        // M11：静态页应用
      } else {
        const mod = await import(/* @vite-ignore */ app.entry)
        mod.setup(uiCtx)
      }
      loadedIds.add(app.id)
    } catch (e) {
      console.error(`插件 ${app.id} 前端加载失败`, e)
      failed.push(app.id)
    }
  }
  return failed
}

export function unloadApp(appId: string) {
  loadedIds.delete(appId)
  _uiCtx?.unregisterApp(appId)
}

/** 安装后增量加载新应用（不重载已加载的） */
export async function syncInstalled(): Promise<string[]> {
  if (!_uiCtx) return []
  return syncAppPlugins(_uiCtx)
}

export function isLoaded(appId: string): boolean {
  return loadedIds.has(appId)
}
