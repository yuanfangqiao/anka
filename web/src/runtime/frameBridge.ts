import { watch } from 'vue'
import { createAppServices } from './appServices'
import { frameNavigation } from './frameNavigation'
import { appRuntime } from './appRuntime'

/** A dedicated port binds identity to the exact iframe window, never to a caller supplied app ID. */
export function attachFrameBridge(frame: HTMLIFrameElement, appId: string) {
  const services = createAppServices(appId)
  let disconnect = () => {}
  const connect = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || event.origin !== location.origin
      || event.data?.source !== 'anka-sdk' || event.data?.version !== 1 || event.data?.type !== 'connect') return
    disconnect()
    const channel = new MessageChannel()
    const port = channel.port1
    const disposers: Array<() => void> = []
    const pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
    let serial = 0
    let closed = false
    const send = (data: unknown) => { if (!closed) port.postMessage(data) }
    const request = (method: string, params?: unknown) => new Promise<any>((resolve, reject) => {
      const id = 'host:' + ++serial
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('应用响应超时')) }, 10000)
      pending.set(id, { resolve, reject, timer })
      send({ type: 'request', id, method, params })
    })
    const navigation = frameNavigation(appId, route => send({ type: 'event', name: 'route', data: route }))
    disposers.push(navigation.stop)
    const subscriptions = new Map<string, () => void>()
    const handlers: Record<string, (params: any) => any> = {
      'focus': () => appRuntime.focus(appId),
      'state': () => ({ ...services.lifecycle.state.value, theme: services.theme.value, route: navigation.current() }),
      'navigation.push': p => navigation.push(p.path),
      'navigation.replace': p => navigation.push(p.path, true),
      'navigation.back': () => navigation.back(),
      'apps.open': p => services.apps.open(p.appId),
      'events.emit': p => services.events.emit(p.name, p.data),
      'events.subscribe': p => {
        if (subscriptions.has(p.name)) return
        const stop = services.events.on(p.name, data => send({ type: 'event', name: 'bus:' + p.name, data }))
        subscriptions.set(p.name, stop)
      },
      'events.unsubscribe': p => { subscriptions.get(p.name)?.(); subscriptions.delete(p.name) },
      'storage.get': p => services.storage.get(p.key),
      'storage.set': p => services.storage.set(p.key, p.value),
      'storage.remove': p => services.storage.remove(p.key),
      'commands.execute': p => services.commands.execute(p.name, p.args),
      'commands.register': p => {
        const stop = services.commands.register(p.name, args => request('command', { name: p.name, args }))
        disposers.push(stop)
      },
      'beforeClose': () => {
        disposers.push(services.lifecycle.beforeClose(() => request('beforeClose')))
      },
    }
    port.onmessage = async ({ data }) => {
      if (!data || typeof data.id !== 'string' || data.id.length > 80) return
      if (data.type === 'response') {
        const item = pending.get(data.id)
        if (!item) return
        clearTimeout(item.timer); pending.delete(data.id)
        data.error ? item.reject(new Error(String(data.error))) : item.resolve(data.result)
        return
      }
      if (data.type !== 'request') return
      try {
        if (JSON.stringify(data).length > 262144) throw new Error('消息超过 256KB')
        const handler = Object.prototype.hasOwnProperty.call(handlers, data.method) ? handlers[data.method] : undefined
        if (!handler) throw new Error('不支持的应用接口')
        const result = await handler(data.params ?? {})
        send({ type: 'response', id: data.id, result })
      } catch (error) { send({ type: 'response', id: data.id, error: error instanceof Error ? error.message : String(error) }) }
    }
    for (const name of ['state', 'activate', 'deactivate', 'close'] as const) {
      disposers.push(services.lifecycle.on(name, data => send({ type: 'event', name, data })))
    }
    disposers.push(watch(services.theme, theme => send({ type: 'event', name: 'theme', data: theme })))
    disconnect = () => {
      closed = true
      for (const stop of disposers) stop()
      for (const stop of subscriptions.values()) stop()
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('应用已断开')) }
      pending.clear(); port.close()
    }
    frame.contentWindow!.postMessage({ source: 'anka-host', version: 1, type: 'connected',
      nonce: event.data.nonce, appId, state: services.lifecycle.state.value, theme: services.theme.value,
      route: navigation.current() }, event.origin, [channel.port2])
    port.start()
  }
  window.addEventListener('message', connect)
  // A document reload must revoke the old port and all its subscriptions.
  const reload = () => disconnect()
  frame.addEventListener('load', reload)
  return () => { window.removeEventListener('message', connect); frame.removeEventListener('load', reload); disconnect() }
}
