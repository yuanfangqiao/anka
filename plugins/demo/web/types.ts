/**
 * uiCtx 类型契约（插件侧最小声明）
 *
 * 插件是自包含文件夹（可从 git 独立安装），不能跨目录 import 宿主源码，
 * 故自带这份与内核 web/src/registry/uiCtx.ts 对齐的类型声明。
 */
import type * as Vue from 'vue'
import type { Component, ComputedRef } from 'vue'

export interface AppMeta {
  id: string
  title: string
  icon: string
  route: string
  order: number
  component: Component
}

export interface UiCtx {
  vue: typeof Vue
  components: Record<string, Component>
  icons: Record<string, Component>
  api: {
    getAppState<T = Record<string, unknown>>(id: string): Promise<T>
    callApp<T = unknown>(
      id: string,
      method: string,
      args?: Record<string, unknown>,
    ): Promise<{ ok: boolean; result: T }>
  }
  toast: { ok: (msg: string) => void; err: (msg: string) => void }
  layout: { isMobile: ComputedRef<boolean>; isWide: ComputedRef<boolean> }
  registerApp: (meta: AppMeta) => void
  unregisterApp: (appId: string) => void
}
