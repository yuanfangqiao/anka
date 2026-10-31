import { getCurrentScope, onScopeDispose } from 'vue'
import type { AppState, LifecycleEvent } from './contracts'

type Listener = (value: any) => void
const subscriptions = new Map<string, Set<{ owner: string; callback: Listener }>>()
const commands = new Map<string, { owner: string; handler: (args: any) => any }>()
const guards = new Map<string, Set<() => boolean | string | Promise<boolean | string>>>()

export function owned(owner: string, dispose: () => void) {
  let active = true
  const stop = () => { if (active) { active = false; dispose() } }
  if (getCurrentScope()) onScopeDispose(stop)
  return stop
}

export function subscribe(owner: string, topic: string, callback: Listener) {
  if (typeof callback !== 'function') throw new Error('监听器必须是函数')
  const listeners = subscriptions.get(topic) ?? new Set()
  const entry = { owner, callback }
  listeners.add(entry)
  subscriptions.set(topic, listeners)
  return owned(owner, () => {
    listeners.delete(entry)
    if (!listeners.size) subscriptions.delete(topic)
  })
}

export function publish(topic: string, value: unknown) {
  for (const { callback } of [...(subscriptions.get(topic) ?? [])]) {
    try { callback(value) } catch (error) { console.error('[app-channel]', topic, error) }
  }
}

export function lifecycle(appId: string, event: LifecycleEvent, state: AppState) {
  publish(`$lifecycle:${appId}:${event}`, state)
}

export function eventTopic(name: string) {
  if (!/^[a-zA-Z0-9][\w.:/-]{0,127}$/.test(name) || name.startsWith('$')) {
    throw new Error('无效的事件名称')
  }
  return `event:${name}`
}

export function registerCommand(owner: string, name: string, handler: (args: any) => any) {
  if (!/^[\w.-]{1,80}$/.test(name)) throw new Error('无效的命令名称')
  const key = `${owner}:${name}`
  if (commands.has(key)) throw new Error(`命令已存在: ${key}`)
  const command = { owner, handler }
  commands.set(key, command)
  return owned(owner, () => { if (commands.get(key) === command) commands.delete(key) })
}

export async function executeCommand(key: string, args?: unknown) {
  const command = commands.get(key)
  if (!command) throw new Error(`命令不可用: ${key}`)
  return command.handler(structuredClone(args))
}

export function listCommands() { return [...commands.keys()] }

export function beforeClose(owner: string, guard: () => boolean | string | Promise<boolean | string>) {
  const set = guards.get(owner) ?? new Set()
  set.add(guard)
  guards.set(owner, set)
  return owned(owner, () => { set.delete(guard); if (!set.size) guards.delete(owner) })
}

export async function allowClose(owner: string) {
  for (const guard of [...(guards.get(owner) ?? [])]) {
    const answer = await guard()
    if (answer !== true) throw new Error(typeof answer === 'string' ? answer : '应用暂时不能关闭，请先保存或结束任务')
  }
}

export function disposeOwner(owner: string) {
  for (const [topic, listeners] of subscriptions) {
    for (const entry of listeners) if (entry.owner === owner) listeners.delete(entry)
    if (!listeners.size) subscriptions.delete(topic)
  }
  for (const [key, command] of commands) if (command.owner === owner) commands.delete(key)
  guards.delete(owner)
}
