/**
 * pluginHost —— 应用插件的动态加载宿主。
 * fetch /api/apps → 逐个 import(entry) → setup(uiCtx)。
 * 已加载的 id 记录去重；卸载 = unregisterApp（刷新后彻底干净）。
 */
import type { UiCtx } from '../registry/uiCtx'
import { api } from './api'

const loadedIds = new Set<string>()
let _uiCtx: UiCtx | null = null

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
      const mod = await import(/* @vite-ignore */ app.entry)
      mod.setup(uiCtx)
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
