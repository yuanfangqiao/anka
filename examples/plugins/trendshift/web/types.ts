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
