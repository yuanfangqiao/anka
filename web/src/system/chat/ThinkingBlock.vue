<script setup lang="ts">
/**
 * ThinkingBlock —— 对话内的模型思考链折叠块（M19，对齐 DeepSeek Harness）。
 *
 * 思考过程不再直接铺开（刷屏），收纳成一行摘要：
 *  - 进行中：「思考中…」（spinner）
 *  - 已完成：「已思考 N 秒」（历史会话用持久化 reasoning_ms 兜底）
 *  - 点击展开全文：限高滚动区，小字次要色
 */
import { Brain, ChevronDown, Loader2 } from 'lucide-vue-next'
import { computed, ref } from 'vue'

const props = defineProps<{
  text: string
  ts?: number
  doneTs?: number
  ms?: number
}>()

const expanded = ref(false)

/** doneTs 存在（含历史投影的 0）即已完结；缺失 = 流式中 */
const done = computed(() => props.doneTs !== undefined)

const seconds = computed(() => {
  if (props.ts && props.doneTs) return (props.doneTs - props.ts) / 1000
  if (props.ms) return props.ms / 1000
  return null
})

const summary = computed(() => {
  if (!done.value) return '思考中…'
  if (seconds.value === null) return '思考过程'
  return `已思考 ${Math.max(1, Math.round(seconds.value))} 秒`
})
</script>

<template>
  <div class="text-xs">
    <button
      type="button"
      class="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-ink-2 transition-all duration-micro hover:bg-glass cursor-pointer"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <Loader2 v-if="!done" :size="13" class="shrink-0 animate-spin text-brand" />
      <Brain v-else :size="13" class="shrink-0 text-brand-cyan" />
      <span class="min-w-0 flex-1 truncate" :class="done ? '' : 'animate-pulse'">{{ summary }}</span>
      <ChevronDown
        :size="13"
        class="shrink-0 transition-transform duration-micro"
        :class="expanded ? 'rotate-180' : ''"
      />
    </button>

    <div
      v-if="expanded"
      class="ml-3 mt-1 max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border-l-2 border-line bg-bg-0 p-2 text-[11px] leading-relaxed text-ink-2"
    >
      {{ text }}
    </div>
  </div>
</template>
