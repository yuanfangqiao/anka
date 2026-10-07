<script setup lang="ts">
/**
 * BackgroundTaskIndicator —— 后台任务指示条（M17.4，替代 AgentProcessPanel）。
 *
 * DeepSeek Harness 同款形态：全局 fixed 顶部居中的轻量胶囊「N 个后台任务运行中」。
 * 仅在**有活动 run 且不在对话页**时显示（对话页内已有 M17.3 的收纳式过程展示，
 * 不冗余）；点击展开气泡：每个 run 的当前步骤一行 + 耗时 + 终止 + 跳转对话。
 *
 * useChat 的 run 订阅模型（服务端常驻 / 断线重连 / 刷新重挂）全部复用，零改动。
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Brain, ChevronDown, Loader2, MessageSquareText, Square, SquareTerminal, Wrench,
} from 'lucide-vue-next'
import { useChat, type RunView, type Step } from '../system/chat/useChat'

const route = useRoute()
const router = useRouter()
const { runs, loadSession, activeSessionId, stopRun } = useChat()

const expanded = ref(false)

/** 对话页内不显示（页面内已有过程展示） */
const activeRuns = computed(() => runs.value.filter((r) => r.active))
const visible = computed(() => activeRuns.value.length > 0 && route.path !== '/chat')

watch(visible, (v) => { if (!v) expanded.value = false })

// ─── 计时（仅展开态需要秒级跳动；收起态只随计数重渲染）──────
const now = ref(Date.now())
const timer = window.setInterval(() => { if (expanded.value) now.value = Date.now() }, 1000)
onUnmounted(() => window.clearInterval(timer))

function elapsed(run: RunView): string {
  const s = Math.max(0, Math.floor((now.value - run.startedAt) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`
}

/** 当前步骤一行摘要：steps 尾条（思考中 / 正在运行命令 · cmd） */
function currentStep(run: RunView): Step | null {
  const steps = run.steps
  return steps.length ? steps[steps.length - 1] : null
}

function stepLine(s: Step | null): string {
  if (!s) return '等待模型响应…'
  if (s.kind === 'think') {
    if (s.done) return `思考完成 · 第 ${s.turn ?? '?'} 轮`
    const t = (s.text ?? '').trim()
    return t ? `思考中 · …${t.slice(-36)}` : '思考中…'
  }
  if (!s.done) return s.cmd ? `正在运行命令 · ${s.cmd.slice(0, 36)}` : `正在执行 ${s.name}`
  return `已执行 ${s.name}`
}

// ─── 动作 ─────────────────────────────────────────────
function openChat(run: RunView) {
  if (activeSessionId.value !== run.sessionId) loadSession(run.sessionId)
  router.push('/chat')
  expanded.value = false
}

// 外点收起气泡（胶囊自身豁免）
function onDocPointerDown(e: PointerEvent) {
  if (!expanded.value) return
  const el = e.target as HTMLElement
  if (!el.closest('[data-bti-root]')) expanded.value = false
}
document.addEventListener('pointerdown', onDocPointerDown)
onUnmounted(() => document.removeEventListener('pointerdown', onDocPointerDown))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      data-bti-root
      class="fixed left-1/2 z-[55] -translate-x-1/2"
      style="top: calc(env(safe-area-inset-top, 0px) + 10px)"
    >
      <!-- 收起态：轻量胶囊 -->
      <button
        type="button"
        class="glass-panel flex h-9 items-center gap-2 rounded-full px-4 shadow-card transition-all duration-micro hover:brightness-110 active:scale-95 cursor-pointer"
        @click="expanded = !expanded"
      >
        <Loader2 :size="13" class="animate-spin text-brand" />
        <span class="text-xs font-medium text-ink-1">
          {{ activeRuns.length }} 个后台任务运行中
        </span>
        <ChevronDown
          :size="13"
          class="text-ink-2 transition-transform duration-micro"
          :class="expanded ? 'rotate-180' : ''"
        />
      </button>

      <!-- 展开态：气泡卡片 -->
      <Transition name="bti-pop">
        <div
          v-if="expanded"
          class="glass-panel absolute left-1/2 top-11 w-72 max-w-[86vw] -translate-x-1/2 overflow-hidden rounded-2xl shadow-card"
          role="dialog"
          aria-label="后台任务列表"
        >
          <!-- 运行中光带 -->
          <div class="h-0.5 w-full bg-gradient-to-r from-brand via-brand-cyan to-brand"></div>

          <section v-for="run in activeRuns" :key="run.id" class="border-b border-line p-3 last:border-b-0">
            <p class="truncate text-xs font-semibold text-ink-0">{{ run.preview || '新任务' }}</p>

            <!-- 当前步骤一行 -->
            <p class="mt-1.5 flex items-center gap-1.5 text-[11px] text-ink-2">
              <component
                :is="currentStep(run)?.kind === 'think' ? Brain : currentStep(run)?.done ? Wrench : SquareTerminal"
                :size="12"
                :class="currentStep(run)?.done ? 'text-ok' : 'text-brand-cyan'"
              />
              <span class="min-w-0 flex-1 truncate">{{ stepLine(currentStep(run)) }}</span>
              <span class="shrink-0 tabular-nums text-ink-2">{{ elapsed(run) }}</span>
            </p>

            <!-- 操作 -->
            <div class="mt-2 flex items-center gap-2">
              <button
                type="button"
                class="flex flex-1 items-center justify-center gap-1 rounded-lg bg-gradient-to-r from-brand to-brand-cyan px-2 py-1.5 text-[11px] font-medium text-white shadow-glow transition-all duration-micro hover:brightness-110 active:scale-95 cursor-pointer"
                @click="openChat(run)"
              >
                <MessageSquareText :size="11" /> 打开对话
              </button>
              <button
                type="button"
                class="flex items-center gap-1 rounded-lg bg-glass px-2.5 py-1.5 text-[11px] text-err transition-all duration-micro hover:brightness-110 active:scale-95 cursor-pointer"
                @click="stopRun(run.id)"
              >
                <Square :size="10" fill="currentColor" /> 终止
              </button>
            </div>
          </section>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>

<style scoped>
.bti-pop-enter-active,
.bti-pop-leave-active {
  transition: opacity 200ms ease, transform 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
.bti-pop-enter-from,
.bti-pop-leave-to {
  opacity: 0;
  transform: translate(-50%, 4px);
}
</style>
