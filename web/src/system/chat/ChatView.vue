<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { Bot, PanelLeftOpen, Send, Square, SquareTerminal, User, Wrench, X } from 'lucide-vue-next'
import BaseCard from '../../components/ui/BaseCard.vue'
import BasePanel from '../../components/ui/BasePanel.vue'
import ChatSidebar from './ChatSidebar.vue'
import { useChat, type Block } from './useChat'
import { isMobile } from '../../composables/useBreakpoint'
import type { ToolCard } from '../../services/api'

const {
  messages, sending, tick, models, currentModel,
  loadModels, selectModel, refreshSessions, send, stop,
} = useChat()

const draft = ref('')
const listEl = ref<HTMLElement>()
const panelOpen = ref(false)

onMounted(() => { loadModels(); refreshSessions() })
onUnmounted(() => { if (sending.value) stop() })

watch(tick, scrollBottom)

async function scrollBottom() {
  await nextTick()
  listEl.value?.scrollTo({ top: listEl.value.scrollHeight, behavior: 'smooth' })
}

function submit() {
  const text = draft.value
  if (!text.trim() || sending.value) return
  draft.value = ''
  send(text)
}

function textOf(b: Block): string {
  return b.kind === 'text' ? b.text : ''
}

function toolOf(b: Block): ToolCard | null {
  return b.kind === 'tool' ? b.tool : null
}

function toolCmd(args?: Record<string, unknown>): string {
  if (!args) return ''
  return (args.command as string) ?? (args.path as string) ?? JSON.stringify(args)
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
          <p class="text-sm font-medium">Agent 对话</p>
          <p class="truncate text-xs text-ink-2">inject: llm, tools · provide: agents</p>
        </div>
        <select
          v-model="currentModel"
          class="max-w-[220px] cursor-pointer rounded-full border border-line bg-glass px-2.5 py-1 text-[11px] text-ink-1 outline-none transition-all duration-micro hover:border-brand/40"
          aria-label="选择模型"
          @change="selectModel(currentModel)"
        >
          <option v-for="m in models" :key="m.id" :value="m.id">{{ m.name }}</option>
        </select>
      </BaseCard>

      <div ref="listEl" class="stagger flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
        <div
          v-if="!messages.length"
          class="flex flex-1 flex-col items-center justify-center gap-2 text-center text-ink-2"
        >
          <Bot :size="26" class="opacity-60" />
          <p class="text-sm">开始一段新对话吧</p>
        </div>

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
            <p
              v-if="!m.blocks.length && sending"
              class="rounded-2xl rounded-tl-md glass-panel px-3.5 py-2.5 text-sm text-ink-2"
            >
              …
            </p>

            <template v-for="(b, i) in m.blocks" :key="i">
              <div
                v-if="textOf(b)"
                class="rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap"
                :class="
                  m.role === 'user'
                    ? 'rounded-tr-md bg-gradient-to-r from-brand to-brand-cyan text-white'
                    : 'rounded-tl-md glass-panel text-ink-0'
                "
              >
                {{ textOf(b) }}
              </div>
              <BaseCard
                v-else-if="toolOf(b)"
                class="!rounded-xl !p-3 text-xs"
              >
                <p class="flex items-center gap-1.5 font-medium text-warn">
                  <Wrench :size="13" /> 工具调用 · {{ toolOf(b)?.name }}
                </p>
                <p class="mt-2 flex items-center gap-1.5 rounded-lg bg-bg-0 px-2.5 py-1.5 font-mono text-ink-1">
                  <SquareTerminal :size="13" class="text-brand-cyan" /> $ {{ toolCmd(toolOf(b)?.args) }}
                </p>
                <p class="mt-1.5 font-mono whitespace-pre-wrap break-all text-ink-2">{{ toolOf(b)?.result }}</p>
              </BaseCard>
            </template>

            <p v-if="m.stopped" class="text-right text-[11px] text-ink-2">已终止</p>
          </div>
        </div>
      </div>

      <form
        class="glass-panel flex items-center gap-2 rounded-2xl p-2 shadow-card"
        @submit.prevent="submit"
      >
        <input
          v-model="draft"
          type="text"
          placeholder="给 Agent 发条消息…"
          class="h-10 flex-1 bg-transparent px-3 text-sm text-ink-0 placeholder:text-ink-2 border-0 outline-none shadow-none focus:ring-0"
        />
        <button
          v-if="sending"
          type="button"
          class="flex h-10 w-10 items-center justify-center rounded-xl bg-bg-2 text-ink-0 transition-all duration-micro hover:brightness-110 active:scale-90 cursor-pointer"
          aria-label="终止"
          @click="stop"
        >
          <Square :size="15" fill="currentColor" />
        </button>
        <button
          v-else
          type="submit"
          :disabled="!draft.trim()"
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
          <ChatSidebar @select="panelOpen = false" />
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
