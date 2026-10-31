import { computed } from 'vue'
import { useTheme } from '../composables/useTheme'
import { appRuntime } from './appRuntime'
import { beforeClose, eventTopic, executeCommand, listCommands, publish, registerCommand, subscribe } from './channels'
import type { LifecycleEvent } from './contracts'
import { authUser } from '../composables/useAuth'

export function appStorage(appId: string) {
  const prefix = `anka:app:${encodeURIComponent(authUser.value ?? 'anonymous')}:${encodeURIComponent(appId)}:`
  const key = (name: string) => {
    if (typeof name !== 'string' || !name || name.length > 128) throw new Error('无效的存储名称')
    return prefix + name
  }
  return {
    get(name: string) {
      const value = localStorage.getItem(key(name))
      return value === null ? null : JSON.parse(value)
    },
    set(name: string, value: unknown) {
      const text = JSON.stringify(value)
      if (typeof text !== 'string' || text.length > 262144) throw new Error('存储值须为不超过 256KB 的 JSON')
      localStorage.setItem(key(name), text)
    },
    remove(name: string) { localStorage.removeItem(key(name)) },
  }
}

export function createAppServices(appId: string, active = () => true) {
  return {
    appId,
    sdkVersion: 1 as const,
    route: computed(() => appRuntime.runs.get(appId)?.route.fullPath ?? ''),
    lifecycle: {
      state: computed(() => appRuntime.appState(appId)),
      on(event: LifecycleEvent, callback: (state: ReturnType<typeof appRuntime.appState>) => void) {
        if (!active()) return () => {}
        if (!['state', 'activate', 'deactivate', 'close'].includes(event)) throw new Error('未知生命周期')
        const stop = subscribe(appId, `$lifecycle:${appId}:${event}`, callback)
        if (event === 'state') callback(appRuntime.appState(appId))
        return stop
      },
      beforeClose: (guard: () => boolean | string | Promise<boolean | string>) => active() ? beforeClose(appId, guard) : () => {},
    },
    events: {
      on: (name: string, callback: (event: { source: string; data: unknown }) => void) => active() ? subscribe(appId, eventTopic(name), callback) : () => {},
      emit(name: string, data?: unknown) {
        publish(eventTopic(name), { source: appId, data: structuredClone(data) })
      },
    },
    commands: {
      register: (name: string, handler: (args: any) => any) => active() ? registerCommand(appId, name, handler) : () => {},
      async execute(target: string, args?: unknown) {
        const targetApp = target.slice(0, target.indexOf(':'))
        if (!targetApp) throw new Error('命令格式为 appId:command')
        // Loading the provider registers its command without opening a window.
        await appRuntime.load(targetApp)
        return executeCommand(target, args)
      },
      list: listCommands,
    },
    storage: appStorage(appId),
    theme: useTheme().theme,
    apps: {
      open: appRuntime.open, close: appRuntime.close, restart: appRuntime.restart,
      list: () => appRuntime.running.value.map(run => ({ ...appRuntime.appState(run.id), status: run.status })),
    },
  }
}
