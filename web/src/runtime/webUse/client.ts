import { ref, watch } from 'vue'
import { authUser } from '../../composables/useAuth'
import { makeExecutor } from './execute'

export const webUseEnabled = ref(false)
export const webUseStatus = ref<'off' | 'connecting' | 'ready'>('off')

let socket: WebSocket | undefined
let clientId: string | undefined
let boundRun: string | undefined
let connecting: Promise<string> | undefined
let abortCommand: AbortController | undefined
let heartbeat: number | undefined
const executor = makeExecutor()

function disconnect() {
  abortCommand?.abort()
  executor.clear()
  const ws = socket
  socket = undefined
  clientId = undefined
  boundRun = undefined
  connecting = undefined
  window.clearInterval(heartbeat)
  heartbeat = undefined
  ws?.close()
  webUseStatus.value = 'off'
}

export function stopWebUse() {
  webUseEnabled.value = false
  disconnect()
}

export function stopWebUseRun(id: string) {
  if (boundRun === id) stopWebUse()
}

export function bindWebUseRun(id: string, client: string) {
  if (client === clientId) boundRun = id
}

watch(authUser, user => { if (!user) stopWebUse() })
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') stopWebUse()
})

export function connectWebUse(): Promise<string> {
  if (!webUseEnabled.value) return Promise.reject(Error('网页操作未开启'))
  if (clientId && socket?.readyState === WebSocket.OPEN) return Promise.resolve(clientId)
  if (connecting) return connecting
  webUseStatus.value = 'connecting'
  const url = new URL('/api/web-use/ws', location.href)
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws = new WebSocket(url)
  socket = ws
  let ready = false
  let commandId: string | undefined
  let lease: string | undefined
  let timer = 0
  connecting = new Promise<string>((resolve, reject) => {
    const close = () => {
      window.clearTimeout(timer)
      if (socket === ws) {
        if (ready) webUseEnabled.value = false
        disconnect()
      }
      if (!ready) reject(Error('未能连接网页操作，请检查 Anka 服务后重试'))
    }
    timer = window.setTimeout(close, 4500)
    ws.onclose = close
    ws.onerror = close
    ws.onmessage = async event => {
      if (socket !== ws || typeof event.data !== 'string') return
      let msg
      try { msg = JSON.parse(event.data) } catch { return }
      if (!msg || typeof msg !== 'object') return
      if (!ready && msg.type === 'ready' && typeof msg.clientId === 'string') {
        ready = true
        window.clearTimeout(timer)
        clientId = msg.clientId
        webUseStatus.value = 'ready'
        heartbeat = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send('{"type":"ping"}')
        }, 20_000)
        resolve(msg.clientId)
        return
      }
      if (!ready || !webUseEnabled.value) return
      if (msg.type === 'cancel' && msg.id === commandId) {
        abortCommand?.abort()
        executor.clear()
        return
      }
      if (msg.type !== 'command' || typeof msg.id !== 'string' || typeof msg.lease !== 'string') return
      if (commandId) {
        ws.send(JSON.stringify({ type: 'result', id: msg.id, ok: false, error: '浏览器正在处理上一个动作' }))
        return
      }
      if (lease !== msg.lease) { executor.clear(); lease = msg.lease }
      commandId = msg.id
      const controller = new AbortController()
      abortCommand = controller
      const reply = (value: object) => {
        if (socket === ws && ws.readyState === WebSocket.OPEN && !controller.signal.aborted) {
          ws.send(JSON.stringify({ type: 'result', id: msg.id, ...value }))
        }
      }
      try {
        const data = await executor.execute(msg.command, msg.args || {}, controller.signal, async blob => {
          const res = await fetch('/api/web-use/image/' + encodeURIComponent(msg.id), {
            method: 'POST', headers: { 'Content-Type': blob.type, 'X-Anka-Web-Client': clientId! },
            body: blob, signal: controller.signal,
          })
          if (!res.ok) throw Error('画面上传失败')
        })
        reply({ ok: true, data })
      } catch (error) {
        reply({ ok: false, error: error instanceof Error ? error.message : '网页动作失败' })
      } finally {
        commandId = undefined
        if (abortCommand === controller) abortCommand = undefined
      }
    }
  })
  return connecting
}
