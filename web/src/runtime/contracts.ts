import type { RouteLocationNormalizedLoaded } from 'vue-router'

export interface RuntimePolicy {
  apiVersion?: 1
  keepAlive?: boolean
  preload?: 'none' | 'resources' | 'execute'
  background?: 'pause' | 'continue'
}

export interface AppRun {
  id: string
  key: number
  route: RouteLocationNormalizedLoaded
  status: 'loading' | 'ready' | 'error'
  error: string
  visible: boolean
  focused: boolean
  lastUsed: number
  parentId?: string
}

export interface AppState {
  appId: string
  running: boolean
  visible: boolean
  focused: boolean
  foreground: boolean
  background: 'pause' | 'continue'
}

export type LifecycleEvent = 'state' | 'activate' | 'deactivate' | 'close'
export const APP_RUNTIME_KEY = Symbol('anka-app-runtime')
