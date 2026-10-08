/**
 * 对话状态（M17）—— 模块级单例，ChatView / ChatSidebar / AgentProcessPanel 共享。
 *
 * M17 重构：从「POST /api/chat 直连 SSE」升级为「run 订阅模型」（借鉴 pi durable harness）：
 *  - run 的生命周期在服务端：POST /api/chat 只启动，事件走 GET /api/runs/{id}/stream
 *  - 切应用 / 切路由 / 切后台 / 刷新页面都不中断执行——断连≠取消，只有 stop 才终止
 *  - 事件带 seq 游标，断线自动重连（after=cursor 无重无漏）；页面刷新后凭
 *    GET /api/runs 找回活动 run 并重放全量事件重建现场
 *  - 过程可视化：每个 run 维护 steps（思考 / 工具执行步骤流），供全局悬浮过程面板渲染
 */

import { computed, reactive, ref } from 'vue'
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
  images?: string[]       // M17.9：用户消息附带图片（支持多张，vision）
  stopped?: boolean
  error?: boolean
}

/** 过程面板步骤：思考（模型输出）或工具执行 */
export interface Step {
  kind: 'think' | 'tool'
  text?: string
  turn?: number
  name?: string
  cmd?: string
  result?: string
  done: boolean
  ts: number
  doneTs?: number
}

export interface RunView {
  id: string
  sessionId: string
  preview: string
  active: boolean
  stopped: boolean
  error: boolean
  bubbles: ChatMsg[]
  steps: Step[]
  startedAt: number
  // —— 以下为续传内部状态（不参与模板渲染语义）——
  _cursor: number
  _newTurn: boolean
  _attached: boolean
}

let seq = 0
const nextId = () => ++seq

const messages = ref<ChatMsg[]>([])
const sessions = ref<SessionSummary[]>([])
const activeSessionId = ref('')
const runs = ref<RunView[]>([])
const pending = ref(false)        // startChat 请求进行中（防连击）
const tick = ref(0)

const models = ref<{ id: string; name: string }[]>([])
const currentModel = ref('')

const bump = () => { tick.value++ }

/** 当前会话正在活动的 run（驱动 sending 态与 ChatView 实时气泡） */
const activeRun = computed(
  () => runs.value.find((r) => r.active && r.sessionId === activeSessionId.value) ?? null,
)
const sending = computed(() => pending.value || Boolean(activeRun.value))

/** 历史消息 + 当前会话活动 run 的实时气泡（ChatView 与创造模式浮窗共用渲染源） */
const displayMessages = computed(() =>
  activeRun.value ? [...messages.value, ...activeRun.value.bubbles] : messages.value)

function toMsg(m: SessionMessage): ChatMsg {
  const blocks: Block[] = []
  if (m.text) blocks.push({ kind: 'text', text: m.text })
  for (const t of m.tools ?? []) blocks.push({ kind: 'tool', tool: t })
  return {
    id: nextId(),
    role: m.role === 'user' ? 'user' : 'assistant',
    blocks,
    images: m.images ?? [],
  }
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

function toolCmd(args?: Record<string, unknown>): string {
  if (!args) return ''
  return (args.command as string) ?? (args.path as string) ?? JSON.stringify(args)
}

// ─── run 事件应用（实时与重放共用同一路径，保证重建现场一致）─────

function applyEvent(run: RunView, ev: Record<string, unknown>) {
  const type = ev.type as string
  const current = () => run.bubbles[run.bubbles.length - 1]

  if (type === 'status' && ev.phase === 'thinking') {
    run.steps.push({ kind: 'think', text: '', turn: ev.turn as number, done: false, ts: Date.now() })
  } else if (type === 'text_delta') {
    if (run._newTurn) {
      run.bubbles.push({ id: nextId(), role: 'assistant', blocks: [] })
      run._newTurn = false
    }
    const chunk = ev.content as string
    appendText(current(), chunk)
    const think = [...run.steps].reverse().find((s) => s.kind === 'think' && !s.done)
    if (think) think.text = ((think.text ?? '') + chunk).slice(-2000)
  } else if (type === 'tool_call') {
    for (const s of run.steps) if (s.kind === 'think' && !s.done) { s.done = true; s.doneTs = Date.now() }
    current().blocks.push({
      kind: 'tool',
      tool: { name: ev.tool as string, args: (ev.args as Record<string, unknown>) ?? {}, result: '执行中…' },
    })
    run.steps.push({
      kind: 'tool',
      name: ev.tool as string,
      cmd: toolCmd(ev.args as Record<string, unknown>),
      done: false,
      ts: Date.now(),
    })
  } else if (type === 'tool_result') {
    setToolResult(current(), ev.tool as string, ev.result as string)
    const step = [...run.steps].reverse().find((s) => s.kind === 'tool' && !s.done)
    if (step) {
      step.done = true
      step.doneTs = Date.now()
      step.result = String(ev.result ?? '').slice(0, 500)
    }
    run._newTurn = true
  } else if (type === 'error') {
    run.error = true
    current().error = true
    appendText(current(), `出错了：${ev.content}`)
  } else if (type === 'stopped') {
    run.stopped = true
    current().stopped = true
  }
  bump()
}

function finalizeRun(run: RunView) {
  run.active = false
  for (const s of run.steps) if (!s.done) { s.done = true; s.doneTs = Date.now() }
  const hasContent = run.bubbles.some((b) =>
    b.blocks.some((bl) => bl.kind === 'tool' || (bl.kind === 'text' && bl.text)))
  if (!hasContent) {
    const last = run.bubbles[run.bubbles.length - 1]
    if (last) appendText(last, run.stopped ? '（已终止）' : '（无回复）')
  }
  // 现场气泡并入消息流（仅当用户仍停留在该会话；否则历史已从会话日志可取）
  if (run.sessionId === activeSessionId.value) {
    messages.value.push(...run.bubbles)
  }
  run.bubbles = []
  bump()
  refreshSessions()
  // Agent 可能在本次对话里装了插件：增量同步，让 dock 立即出现（M16）
  syncInstalled().then(({ loaded, failed }) => {
    if (loaded.length) toast.ok(`已加载新插件：${loaded.join('、')}`)
    if (failed.length) toast.warn(`插件前端加载失败：${failed.join('、')}（详见控制台）`)
  }).catch(() => {})
  // 过程面板短暂保留完成态后移除
  window.setTimeout(() => {
    runs.value = runs.value.filter((r) => r.id !== run.id)
  }, 8000)
}

/** 订阅 run 事件流；断线自动重连（after=游标续传），直到收到 done 或 run 被回收 */
async function attachStream(run: RunView) {
  if (run._attached) return
  run._attached = true
  for (;;) {
    let gone = false
    try {
      const res = await fetch(`/api/runs/${run.id}/stream?after=${run._cursor}`)
      if (res.status === 404) { gone = true }
      else if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      else {
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        let finished = false
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
            try { ev = JSON.parse(line.slice(5).trim()) } catch { continue }
            run._cursor = (ev.seq as number) ?? run._cursor
            if (ev.type === 'done') { finished = true; continue }
            applyEvent(run, ev)
          }
        }
        if (finished || !run.active) { finalizeRun(run); return }
      }
    } catch { /* 网络抖动/切后台断流 —— 走重连 */ }
    if (gone) {
      // run 已被服务端回收：本地收尾，按会话日志可对账
      finalizeRun(run)
      return
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
}

function newRunView(id: string, sessionId: string, preview: string): RunView {
  // 必须经 reactive 代理：attachStream 持有同一引用做流式变更，
  // 裸对象直改会绕过响应式触发（气泡不实时更新，只能靠计时器被动刷新）
  return reactive({
    id, sessionId, preview,
    active: true, stopped: false, error: false,
    bubbles: [{ id: nextId(), role: 'assistant', blocks: [] }],
    steps: [],
    startedAt: Date.now(),
    _cursor: 0, _newTurn: false, _attached: false,
  })
}

// ─── 会话与模型 ─────────────────────────────────────────────

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

/** 页面加载后重挂服务端仍在执行的 run（刷新/PWA 重启场景） */
async function restoreRuns() {
  let list
  try {
    list = await api.runs()
  } catch { return }
  for (const info of list) {
    if (!info.active) continue
    if (runs.value.some((r) => r.id === info.id)) continue
    const run = newRunView(info.id, info.session_id, info.preview)
    run.startedAt = info.created_at * 1000
    runs.value.unshift(run)
    attachStream(run)     // 全量重放 → 重建思考/工具步骤与气泡
  }
  // 刷新/PWA 重启后：自动回到仍在执行的会话，现场即刻可见
  if (!activeSessionId.value && runs.value.length) {
    const latest = [...runs.value].sort((a, b) => b.startedAt - a.startedAt)[0]
    await loadSession(latest.sessionId)
  }
  if (runs.value.length) bump()
}

// ─── 发送与终止 ─────────────────────────────────────────────

async function send(text: string, images?: string[]) {
  const msg = text.trim()
  const pics = images ?? []
  if ((!msg && !pics.length) || sending.value) return

  messages.value.push({
    id: nextId(), role: 'user',
    blocks: msg ? [{ kind: 'text', text: msg }] : [],
    images: pics,
  })
  bump()

  pending.value = true
  try {
    const started = await api.startChat({
      message: msg || '请根据这些图片进行修改',
      model: currentModel.value || undefined,
      session_id: activeSessionId.value || undefined,
      images: pics.length ? pics : undefined,
    })
    activeSessionId.value = started.session_id
    const run = newRunView(started.run_id, started.session_id, msg)
    runs.value.unshift(run)
    bump()
    attachStream(run)
  } catch (e) {
    const err = e as { message?: string }
    messages.value.push({
      id: nextId(), role: 'assistant',
      blocks: [{ kind: 'text', text: `出错了：${err?.message ?? '网络异常'}` }],
      error: true,
    })
    bump()
  } finally {
    pending.value = false
  }
}

function stop() {
  const run = activeRun.value
  if (run) api.stopRun(run.id).catch(() => {})
}

/** 供过程面板终止任意 run（不限当前会话） */
function stopRun(id: string) {
  api.stopRun(id).catch(() => {})
}

export function useChat() {
  return {
    messages, sessions, activeSessionId, sending, tick, runs, activeRun, displayMessages,
    models, currentModel,
    loadModels, selectModel, refreshSessions, loadSession,
    startNewSession, removeSession, restoreRuns, send, stop, stopRun,
  }
}
