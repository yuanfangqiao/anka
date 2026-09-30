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
  component: Component
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
}
