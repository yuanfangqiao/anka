/**
 * 对话状态（M15）—— 模块级单例，ChatView 与两处 ChatSidebar 实例共享同一份状态。
 *
 * 真数据链路：
 *  - 会话列表 / 历史气泡来自后端 append-only 会话日志（/api/sessions）
 *  - 发送走 /api/chat SSE，token 级 text_delta 追加；tool_call/tool_result 渲染工具卡
 *  - session_id 由后端在首个 session 事件下发，后续轮次复用（多轮上下文由后端投影）
 *  - 终止：AbortController 断开 SSE，后端置 cancel，worker 在下一 chunk 处停下
 */

import { ref } from 'vue'
import { api, type SessionMessage, type SessionSummary, type ToolCard } from '../../services/api'
import { syncInstalled } from '../../services/pluginHost'
import { useToast } from '../../composables/useToast'

const toast = useToast()

export type Block =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; tool: ToolCard }

export interface ChatMsg {
  id: number
  role: 'user' | 'assistant'
  blocks: Block[]
  stopped?: boolean
  error?: boolean
}

let seq = 0
const nextId = () => ++seq

const messages = ref<ChatMsg[]>([])
const sessions = ref<SessionSummary[]>([])
const activeSessionId = ref('')
const sending = ref(false)
const tick = ref(0)

const models = ref<{ id: string; name: string }[]>([])
const currentModel = ref('')

let controller: AbortController | null = null
const bump = () => { tick.value++ }

function toMsg(m: SessionMessage): ChatMsg {
  const blocks: Block[] = []
  if (m.text) blocks.push({ kind: 'text', text: m.text })
  for (const t of m.tools ?? []) blocks.push({ kind: 'tool', tool: t })
  return { id: nextId(), role: m.role === 'user' ? 'user' : 'assistant', blocks }
}

function appendText(msg: ChatMsg, chunk: string) {
  if (!chunk) return
  const last = msg.blocks[msg.blocks.length - 1]
  if (last && last.kind === 'text') last.text += chunk
  else msg.blocks.push({ kind: 'text', text: chunk })
}

function setToolResult(msg: ChatMsg, tool: string, result: string) {
  for (const b of msg.blocks) {
    if (b.kind === 'tool' && b.tool.result === '执行中…' && (!tool || b.tool.name === tool)) {
      b.tool.result = result
      return
    }
  }
}

async function loadModels() {
  try {
    const data = await api.settings()
    models.value = data.models ?? []
    const saved = localStorage.getItem('agentos.model')
    const valid = models.value.some((m) => m.id === saved)
    currentModel.value = valid ? saved! : (data.default_model || models.value[0]?.id || '')
  } catch { /* 后端未连接时忽略 */ }
}

function selectModel(id: string) {
  currentModel.value = id
  localStorage.setItem('agentos.model', id)
  api.saveSettings({ default_model: id }).catch(() => {})
}

async function refreshSessions() {
  try {
    sessions.value = await api.sessions()
  } catch { /* 后端未连接时忽略 */ }
}

async function loadSession(id: string) {
  if (sending.value) stop()
  activeSessionId.value = id
  try {
    const detail = await api.sessionMessages(id)
    messages.value = detail.messages.map(toMsg)
  } catch {
    messages.value = []
  }
  bump()
}

function startNewSession() {
  if (sending.value) stop()
  activeSessionId.value = ''
  messages.value = []
  bump()
}

async function removeSession(id: string) {
  try {
    await api.deleteSession(id)
  } catch { /* 忽略 */ }
  if (activeSessionId.value === id) startNewSession()
  await refreshSessions()
}

function stop() {
  controller?.abort()
}

async function send(text: string) {
  const msg = text.trim()
  if (!msg || sending.value) return

  messages.value.push({ id: nextId(), role: 'user', blocks: [{ kind: 'text', text: msg }] })
  const reply: ChatMsg = { id: nextId(), role: 'assistant', blocks: [] }
  messages.value.push(reply)
  const bubbles: ChatMsg[] = [reply]
  bump()

  sending.value = true
  controller = new AbortController()
  let current = reply
  let newTurn = false

  const startBubble = () => {
    const b: ChatMsg = { id: nextId(), role: 'assistant', blocks: [] }
    messages.value.push(b)
    bubbles.push(b)
    return b
  }

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: msg,
        model: currentModel.value || undefined,
        session_id: activeSessionId.value || undefined,
      }),
      signal: controller.signal,
    })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const frames = buf.split('\n\n')
      buf = frames.pop() ?? ''
      for (const frame of frames) {
        const line = frame.trim()
        if (!line.startsWith('data:')) continue
        let ev: Record<string, unknown>
        try {
          ev = JSON.parse(line.slice(5).trim())
        } catch { continue }
        const type = ev.type as string
        if (type === 'session') {
          activeSessionId.value = ev.session_id as string
        } else if (type === 'text_delta') {
          if (newTurn) { current = startBubble(); newTurn = false }
          appendText(current, ev.content as string)
        } else if (type === 'tool_call') {
          current.blocks.push({
            kind: 'tool',
            tool: {
              name: ev.tool as string,
              args: (ev.args as Record<string, unknown>) ?? {},
              result: '执行中…',
            },
          })
        } else if (type === 'tool_result') {
          setToolResult(current, ev.tool as string, ev.result as string)
          newTurn = true
        } else if (type === 'error') {
          current.error = true
          appendText(current, `出错了：${ev.content}`)
        } else if (type === 'stopped') {
          current.stopped = true
        }
        bump()
      }
    }
    const hasContent = bubbles.some((b) =>
      b.blocks.some((bl) => bl.kind === 'tool' || (bl.kind === 'text' && bl.text)))
    if (!hasContent) reply.blocks.push({ kind: 'text', text: '（无回复）' })
  } catch (e) {
    const err = e as { name?: string; message?: string }
    if (err?.name === 'AbortError') {
      current.stopped = true
      if (!current.blocks.length) appendText(current, '（已终止）')
    } else {
      current.error = true
      appendText(current, `出错了：${err?.message ?? '网络异常'}`)
    }
  } finally {
    sending.value = false
    controller = null
    bump()
    refreshSessions()
    // Agent 可能在本次对话里装了插件：增量同步，让 dock 立即出现（M16）
    syncInstalled().then(({ loaded, failed }) => {
      if (loaded.length) toast.ok(`已加载新插件：${loaded.join('、')}`)
      if (failed.length) toast.warn(`插件前端加载失败：${failed.join('、')}（详见控制台）`)
    }).catch(() => {})
  }
}

export function useChat() {
  return {
    messages, sessions, activeSessionId, sending, tick,
    models, currentModel,
    loadModels, selectModel, refreshSessions, loadSession,
    startNewSession, removeSession, send, stop,
  }
}
