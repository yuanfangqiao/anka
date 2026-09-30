<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { Bot, PanelLeftOpen, Send, SquareTerminal, User, Wrench, X } from 'lucide-vue-next'
import BaseCard from '../../components/ui/BaseCard.vue'
import BasePanel from '../../components/ui/BasePanel.vue'
import ChatSidebar from './ChatSidebar.vue'
import { isMobile } from '../../composables/useBreakpoint'

interface Msg {
  id: number
  role: 'user' | 'agent'
  text: string
  tool?: { name: string; cmd: string; result: string }
}

let seq = 0
const messages = ref<Msg[]>([
  {
    id: ++seq,
    role: 'agent',
    text: '你好，我是由 6 个插件组装出来的 Agent。我的 LLM 是 llm-echo 提供的 Echo Adapter，工具来自 tools-runtime。试着问我「目录里有什么」。',
  },
  {
    id: ++seq,
    role: 'user',
    text: '当前目录里有什么？',
  },
  {
    id: ++seq,
    role: 'agent',
    text: '我调用了 bash 工具看了一下：',
    tool: {
      name: 'tool-bash',
      cmd: 'ls server/app',
      result: 'cordis  plugins  api  main.py  settings.py',
    },
  },
  {
    id: ++seq,
    role: 'agent',
    text: '目录包含 cordis（插件内核）、plugins（六个插件）和 api（FastAPI 路由）。这条回复经过 llm-logger 的 waterfall 包裹，耗时 12ms。',
  },
])

const draft = ref('')
const sending = ref(false)
const listEl = ref<HTMLElement>()
const panelOpen = ref(false)

async function scrollBottom() {
  await nextTick()
  listEl.value?.scrollTo({ top: listEl.value.scrollHeight, behavior: 'smooth' })
}

async function send() {
  const text = draft.value.trim()
  if (!text || sending.value) return
  draft.value = ''
  messages.value.push({ id: ++seq, role: 'user', text })
  scrollBottom()
  sending.value = true

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

    const reply: Msg = { id: ++seq, role: 'agent', text: '' }
    messages.value.push(reply)
    await consumeSse(res.body.getReader(), reply)
    if (!reply.text && !reply.tool) reply.text = '（无回复）'
  } catch (e) {
    console.error('chat sse failed, fallback to local echo', e)
    await localEcho(text)
  } finally {
    sending.value = false
    scrollBottom()
  }
}

async function consumeSse(reader: ReadableStreamDefaultReader<Uint8Array>, reply: Msg) {
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
      const ev = JSON.parse(line.slice(5).trim())
      if (ev.type === 'tool_call') {
        if (!reply.text) reply.text = '我需要先调用一个工具：'
        reply.tool = {
          name: `tool-${ev.tool}`,
          cmd: ev.args?.command ?? JSON.stringify(ev.args),
          result: '执行中…',
        }
      } else if (ev.type === 'tool_result') {
        if (reply.tool) reply.tool.result = ev.result
      } else if (ev.type === 'text') {
        reply.text = ev.content
      } else if (ev.type === 'error') {
        reply.text = `出错了：${ev.content}`
      }
      scrollBottom()
    }
  }
}

async function localEcho(text: string) {
  const reply: Msg = { id: ++seq, role: 'agent', text: '' }
  messages.value.push(reply)
  const full = `[ECHO] ${text} —— 后端未连接；执行 python server/run_dev.py 后，这里会经 SSE 真实流式返回。`
  for (let i = 1; i <= full.length; i++) {
    reply.text = full.slice(0, i)
    if (i % 4 === 0) {
      scrollBottom()
      await new Promise((r) => setTimeout(r, 18))
    }
  }
}
</script>

<template>
  <!-- 单一根节点：Transition out-in 要求子组件单元素根，Fragment 会导致切页永久空白 -->
  <div class="h-full">
    <div class="flex h-full gap-3 p-3">
    <!-- 左栏由 App 自己画（内核不再渲染工作栏） -->
    <aside v-if="!isMobile" class="w-60 shrink-0">
      <BasePanel title="会话">
        <ChatSidebar />
      </BasePanel>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col gap-3">
      <header v-if="isMobile" class="flex items-center gap-2">
        <button
          type="button"
          class="flex h-9 w-9 items-center justify-center rounded-xl bg-glass text-ink-1 border border-line transition-all duration-micro active:scale-90 cursor-pointer"
          aria-label="打开会话栏"
          @click="panelOpen = true"
        >
          <PanelLeftOpen :size="17" />
        </button>
        <h1 class="text-[22px] font-bold tracking-tight">对话</h1>
      </header>

      <BaseCard class="flex items-center gap-3 !p-3">
        <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-brand-cyan text-white">
          <Bot :size="18" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium">agent-loop 运行中</p>
          <p class="truncate text-xs text-ink-2">inject: llm, tools · provide: agents</p>
        </div>
        <span class="flex items-center gap-1.5 rounded-full bg-ok/15 px-2.5 py-1 text-[11px] text-ok">
          <span class="h-1.5 w-1.5 rounded-full bg-ok animate-pulse-dot"></span>Echo Adapter
        </span>
      </BaseCard>

      <div ref="listEl" class="stagger flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
        <div
          v-for="m in messages"
          :key="m.id"
          class="flex gap-2.5"
          :class="m.role === 'user' ? 'flex-row-reverse' : ''"
        >
          <span
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
            :class="m.role === 'user' ? 'bg-bg-2 text-ink-1' : 'bg-brand/15 text-brand'"
          >
            <User v-if="m.role === 'user'" :size="15" />
            <Bot v-else :size="15" />
          </span>
          <div class="max-w-[78%] space-y-2">
            <div
              class="rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed"
              :class="
                m.role === 'user'
                  ? 'rounded-tr-md bg-gradient-to-r from-brand to-brand-cyan text-white'
                  : 'rounded-tl-md glass-panel text-ink-0'
              "
            >
              {{ m.text || '…' }}
            </div>
            <BaseCard v-if="m.tool" class="!rounded-xl !p-3 text-xs">
              <p class="flex items-center gap-1.5 font-medium text-warn">
                <Wrench :size="13" /> 工具调用 · {{ m.tool.name }}
              </p>
              <p class="mt-2 flex items-center gap-1.5 rounded-lg bg-bg-0 px-2.5 py-1.5 font-mono text-ink-1">
                <SquareTerminal :size="13" class="text-brand-cyan" /> $ {{ m.tool.cmd }}
              </p>
              <p class="mt-1.5 font-mono text-ink-2">{{ m.tool.result }}</p>
            </BaseCard>
          </div>
        </div>
      </div>

      <form
        class="glass-panel flex items-center gap-2 rounded-2xl p-2 shadow-card"
        @submit.prevent="send"
      >
        <input
          v-model="draft"
          type="text"
          placeholder="给 Agent 发条消息…"
          class="h-10 flex-1 bg-transparent px-3 text-sm text-ink-0 placeholder:text-ink-2 border-0 outline-none shadow-none focus:ring-0"
        />
        <button
          type="submit"
          :disabled="!draft.trim() || sending"
          class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-r from-brand to-brand-cyan text-white shadow-glow transition-all duration-micro hover:brightness-110 active:scale-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          aria-label="发送"
        >
          <Send :size="17" />
        </button>
      </form>
    </div>
  </div>

  <!-- 手机端：App 自绘的内部面板（内核不再提供公共抽屉） -->
  <Teleport to="body">
    <Transition name="drawer-overlay">
      <div
        v-if="panelOpen"
        class="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]"
        @click="panelOpen = false"
      ></div>
    </Transition>
    <Transition name="drawer">
      <aside
        v-if="panelOpen"
        class="glass-panel fixed inset-y-0 left-0 z-50 flex w-[80%] max-w-[320px] flex-col border-y-0 border-l-0 shadow-card"
        role="dialog"
        aria-label="会话栏"
      >
        <div class="safe-top flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-4">
          <p class="flex-1 text-[15px] font-semibold">会话</p>
          <button
            type="button"
            class="flex h-8 w-8 items-center justify-center rounded-full text-ink-1 transition-all duration-micro hover:bg-glass active:scale-90 cursor-pointer"
            aria-label="收起"
            @click="panelOpen = false"
          >
            <X :size="17" />
          </button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto p-3">
          <ChatSidebar />
        </div>
      </aside>
    </Transition>
  </Teleport>
  </div>
</template>

<style scoped>
.drawer-enter-active,
.drawer-leave-active {
  transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
.drawer-enter-from,
.drawer-leave-to {
  transform: translateX(-100%);
}
.drawer-overlay-enter-active,
.drawer-overlay-leave-active {
  transition: opacity 200ms ease;
}
.drawer-overlay-enter-from,
.drawer-overlay-leave-to {
  opacity: 0;
}
</style>
