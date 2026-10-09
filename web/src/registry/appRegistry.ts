/**
 * 运行时应用注册表（M7：App 自绘布局，内核不再保存工作栏组件）。
 * 系统插件与应用插件经同一个 uiCtx 注册，壳层只渲染 dock 与主窗口。
 */
import { computed, markRaw, reactive, type Component } from 'vue'
import * as LucideIcons from 'lucide-vue-next'

export interface AppMeta {
  id: string
  title: string
  icon: string | Component
  route: string
  order: number
  system: boolean
  inDock: boolean
  /** page 类全屏应用：壳层不渲染顶部栏、不预留 56px 空位 */
  fullscreen?: boolean
  component: Component
}

/** 应用 id → 稳定色相：page 类应用图标同为 package，靠颜色区分身份 */
export function appHue(id: string): number {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

/** 图标容器样式：系统插件走品牌渐变（返回 undefined，用模板类），应用插件用专属色相 */
export function appTileStyle(app: AppMeta): Record<string, string> | undefined {
  if (app.system) return undefined
  const h = appHue(app.id)
  return {
    background: `linear-gradient(135deg, hsl(${h} 74% 62%), hsl(${(h + 42) % 360} 70% 46%))`,
    boxShadow: `0 6px 16px -6px hsl(${h} 74% 52% / 0.55)`,
  }
}

const apps = reactive<AppMeta[]>([])

export function resolveIcon(icon: string | Component): Component {
  if (typeof icon !== 'string') return icon
  const pascal = icon
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')
  return (LucideIcons as Record<string, Component>)[pascal] ?? LucideIcons.Package
}

const dockApps = computed(() =>
  apps.filter((a) => a.inDock).sort((a, b) => a.order - b.order),
)

/** 首个非系统 dock 应用（空系统时为 undefined → 显示空态） */
const firstUserApp = computed(() => dockApps.value.find((a) => !a.system))

function addApp(meta: AppMeta) {
  const normalized = { ...meta, component: markRaw(meta.component) }
  const i = apps.findIndex((a) => a.id === meta.id)
  if (i >= 0) apps.splice(i, 1, normalized)
  else apps.push(normalized)
}

function removeApp(id: string) {
  const i = apps.findIndex((a) => a.id === id)
  if (i >= 0) apps.splice(i, 1)
}

export const registry = {
  apps,
  dockApps,
  firstUserApp,
  addApp,
  removeApp,
  resolveIcon,
  /** M17.12：按 id 查找已注册应用（消除各调用方散落的 apps.find） */
  byId: (id: string) => apps.find((a) => a.id === id),
}
