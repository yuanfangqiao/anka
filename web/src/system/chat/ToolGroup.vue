<script setup lang="ts">
/**
 * ToolGroup —— 对话内的过程摘要组（M17.3，对齐 DeepSeek Harness 前端）。
 *
 * 连续的工具调用不再逐个铺开参数与全量结果（占满屏幕），收纳成一行摘要：
 *  - 进行中：「正在运行命令 · npm run build」（spinner）
 *  - 已完成：「执行了命令，读取了 3 个文件，修改了 2 个文件」
 *  - 点击展开明细：每个工具一行（动作 · 参数摘要），结果折叠进限高滚动区
 */
import { computed, ref } from 'vue'
import {
  ChevronDown, FileEdit, FileSearch, FolderTree, Loader2, Package,
  SquareTerminal, Wrench,
} from 'lucide-vue-next'
import type { ToolCard } from '../../services/api'

const props = defineProps<{ tools: ToolCard[] }>()

const expanded = ref(false)
const running = computed(() => props.tools.some((t) => t.result === '执行中…'))

type Cls = 'cmd' | 'read' | 'write' | 'list' | 'plugin' | 'tool'

function classify(name?: string): Cls {
  if (name === 'bash') return 'cmd'
  if (name?.startsWith('fs_read')) return 'read'
  if (name?.startsWith('fs_write')) return 'write'
  if (name?.startsWith('fs_list')) return 'list'
  if (name?.startsWith('plugin_')) return 'plugin'
  return 'tool'
}

const LABEL: Record<Cls, string> = {
  cmd: '命令', read: '读取文件', write: '修改文件',
  list: '浏览目录', plugin: '插件操作', tool: '调用工具',
}
const ICON: Record<Cls, unknown> = {
  cmd: SquareTerminal, read: FileSearch, write: FileEdit,
  list: FolderTree, plugin: Package, tool: Wrench,
}

const entries = computed(() => props.tools.map((t) => ({ t, c: classify(t.name) })))

/** DeepSeek 式摘要：按出现顺序列出不同动作，文件类带数量 */
const summary = computed(() => {
  const order: Cls[] = []
  const count: Partial<Record<Cls, number>> = {}
  for (const e of entries.value) {
    count[e.c] = (count[e.c] ?? 0) + 1
    if (!order.includes(e.c)) order.push(e.c)
  }
  return order.map((c) => {
    const n = count[c] ?? 0
    if (n > 1) {
      if (c === 'cmd') return `执行了 ${n} 次命令`
      if (c === 'read') return `读取了 ${n} 个文件`
      if (c === 'write') return `修改了 ${n} 个文件`
      return `${n} 项${LABEL[c]}`
    }
    if (c === 'cmd') return '执行了命令'
    if (c === 'read') return '读取了文件'
    if (c === 'write') return '修改了文件'
    if (c === 'list') return '浏览了目录'
    return LABEL[c]
  }).join('，')
})

/** 进行中态：正在运行命令 · <参数摘要>（对齐 DeepSeek「正在运行命令 · Find …」） */
const runningLine = computed(() => {
  const t = props.tools.find((x) => x.result === '执行中…')
  if (!t) return ''
  const c = classify(t.name)
  const arg = argLine(t)
  return arg ? `正在${LABEL[c]} · ${arg.slice(0, 48)}` : `正在${LABEL[c]}`
})

function argLine(t: ToolCard): string {
  const a = t.args ?? {}
  const v = (a.command as string) ?? (a.path as string) ?? (a.id as string)
    ?? (a.name as string) ?? JSON.stringify(a)
  return String(v).replace(/\s+/g, ' ').slice(0, 80)
}

function iconOf(c: Cls) {
  return ICON[c] as typeof Wrench
}
</script>

<template>
  <div class="text-xs">
    <!-- 收纳行 -->
    <button
      type="button"
      class="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-ink-2 transition-all duration-micro hover:bg-glass cursor-pointer"
      @click="expanded = !expanded"
    >
      <Loader2 v-if="running" :size="13" class="shrink-0 animate-spin text-brand" />
      <component
        :is="iconOf(entries[0]?.c ?? 'tool')"
        v-else
        :size="13"
        class="shrink-0 text-brand-cyan"
      />
      <span class="min-w-0 flex-1 truncate">{{ running ? runningLine : summary }}</span>
      <ChevronDown
        :size="13"
        class="shrink-0 transition-transform duration-micro"
        :class="expanded ? 'rotate-180' : ''"
      />
    </button>

    <!-- 明细（限高滚动，避免大结果占满屏） -->
    <div v-if="expanded" class="ml-3 mt-1 space-y-1.5 border-l-2 border-line pl-3">
      <div v-for="(e, i) in entries" :key="i">
        <p class="flex items-center gap-1.5 text-[11px] font-medium text-ink-1">
          <component :is="iconOf(e.c)" :size="11" class="text-brand-cyan" />
          {{ LABEL[e.c] }} · <span class="min-w-0 truncate font-mono font-normal text-ink-2">{{ argLine(e.t) }}</span>
          <Loader2 v-if="e.t.result === '执行中…'" :size="11" class="shrink-0 animate-spin text-brand" />
        </p>
        <pre
          v-if="e.t.result && e.t.result !== '执行中…'"
          class="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-bg-0 p-2 font-mono text-[11px] leading-relaxed text-ink-2"
        >{{ e.t.result.slice(0, 2000) }}{{ e.t.result.length > 2000 ? '\n…（已截断）' : '' }}</pre>
      </div>
    </div>
  </div>
</template>
