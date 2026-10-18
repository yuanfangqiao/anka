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

function toPascal(icon: string): string {
  return icon
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')
}

/** 是否为可用的 lucide 图标名：emoji（如 🍅）等自定义写法返回 false */
export function isLucideIconName(icon: string): boolean {
  return Object.prototype.hasOwnProperty.call(LucideIcons, toPascal(icon))
}

export function resolveIcon(icon: string | Component): Component {
  if (typeof icon !== 'string') return icon
  return (LucideIcons as Record<string, Component>)[toPascal(icon)] ?? LucideIcons.Package
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

/** 覆盖已注册应用的图标：manifest 是唯一权威（见 PLUGIN-SPEC §2.1） */
function setIcon(id: string, icon: string | Component) {
  const app = apps.find((a) => a.id === id)
  if (app) app.icon = icon
}

export const registry = {
  apps,
  dockApps,
  firstUserApp,
  addApp,
  removeApp,
  setIcon,
  isLucideIconName,
  resolveIcon,
  /** M17.12：按 id 查找已注册应用（消除各调用方散落的 apps.find） */
  byId: (id: string) => apps.find((a) => a.id === id),
}
