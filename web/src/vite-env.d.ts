/// <reference types="vite/client" />

declare module 'virtual:pwa-register' {
  export interface RegisterSWOptions {
    immediate?: boolean
    onNeedRefresh?: () => void
    onOfflineReady?: () => void
    /** 仅当未传 onRegisteredSW 时调用 */
    onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void
    /** M17.10：拿住 registration 才能主动 update() —— 修复「后台切回不刷新」的关键 */
    onRegisteredSW?: (swScriptUrl: string, registration: ServiceWorkerRegistration | undefined) => void
    onRegisterError?: (error: unknown) => void
  }
  export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>
}

/** M17.10：构建号（vite define 注入），用于与后端当前部署版本比对 */
declare const __APP_BUILD__: string
