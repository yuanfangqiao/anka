<script setup lang="ts">
/**
 * calculator 主界面：按键仅拼接表达式，「=」经 callApp 发给后端求值。
 * 计算逻辑全部在后端（AST 安全求值），前端零计算。
 */
import { onMounted, ref } from 'vue'
import type { UiCtx } from './types'

const props = defineProps<{ uiCtx: UiCtx }>()

const expr = ref('')
const error = ref('')
const history = ref<{ expr: string; result: string }[]>([])

const KEYS = [
  ['C', '(', ')', '÷'],
  ['7', '8', '9', '×'],
  ['4', '5', '6', '−'],
  ['1', '2', '3', '+'],
  ['0', '.', '⌫', '='],
]

// 显示符号 → Python 运算符（整个表达式做全局替换）
const toPy = (s: string) => s.replace(/÷/g, '/').replace(/×/g, '*').replace(/−/g, '-')

async function refresh() {
  const s = await props.uiCtx.api.getAppState<{ history: typeof history.value }>('calculator')
  history.value = s.history ?? []
}

function press(k: string) {
  error.value = ''
  if (k === 'C') expr.value = ''
  else if (k === '⌫') expr.value = expr.value.slice(0, -1)
  else if (k === '=') evaluate()
  else expr.value += k
}

async function evaluate() {
  if (!expr.value.trim()) return
  try {
    const { result } = await props.uiCtx.api.callApp<{ expr: string; result: string }>(
      'calculator', 'calc', { expr: toPy(expr.value) },
    )
    expr.value = result.result
    await refresh()
  } catch (e: any) {
    // FastAPI 400/500 的 detail.message
    const msg = e?.message ?? '计算失败'
    error.value = /表达式|不支持|空|过长/.test(msg) ? msg : '表达式无效'
  }
}

async function clearHistory() {
  await props.uiCtx.api.callApp('calculator', 'clear')
  await refresh()
}

// 按键配色：= 渐变高亮、数字玻璃、功能键哑色
function keyClass(k: string): string {
  if (k === '=') return 'bg-gradient-to-r from-brand to-brand-cyan text-white shadow-glow'
  if (/^[0-9.]$/.test(k)) return 'bg-glass text-ink-0 border border-line'
  return 'bg-bg-2 text-ink-1 border border-line hover:text-ink-0'
}

onMounted(refresh)
</script>

<template>
  <div class="flex h-full p-3">
    <div class="min-w-0 flex-1 overflow-y-auto">
      <div class="mx-auto flex w-full max-w-sm flex-col gap-4 px-1 pb-4">
        <header class="pt-1">
          <h1 class="text-[30px] font-bold tracking-tight">计算器</h1>
          <p class="mt-1 text-sm text-ink-2">计算在后端完成（AST 安全求值）</p>
        </header>

        <!-- 显示屏 -->
        <div class="glass-panel rounded-2xl px-4 py-3 text-right">
          <div class="min-h-10 break-all text-2xl font-semibold tabular-nums">
            {{ expr || '0' }}
          </div>
          <div v-if="error" class="mt-1 text-xs text-err">{{ error }}</div>
        </div>

        <!-- 按键区 -->
        <div class="grid grid-cols-4 gap-2">
          <button
            v-for="k in KEYS.flat()"
            :key="k"
            type="button"
            class="h-12 rounded-xl text-lg font-medium transition-all duration-micro active:scale-90 cursor-pointer"
            :class="keyClass(k)"
            @click="press(k)"
          >
            {{ k }}
          </button>
        </div>

        <!-- 历史 -->
        <div v-if="history.length" class="mt-1">
          <div class="flex items-center justify-between px-1 text-xs font-medium text-ink-2">
            <span>历史</span>
            <button type="button" class="cursor-pointer hover:text-err" @click="clearHistory">
              清空
            </button>
          </div>
          <div class="stagger mt-2 space-y-1">
            <button
              v-for="(h, i) in history"
              :key="i"
              type="button"
              class="flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm tabular-nums transition-colors hover:bg-glass cursor-pointer"
              @click="expr = h.result"
            >
              <span class="text-ink-2">{{ h.expr }}</span>
              <span class="font-medium text-ink-0">= {{ h.result }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
