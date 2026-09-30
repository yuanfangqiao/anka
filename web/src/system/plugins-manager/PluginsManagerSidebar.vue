<script setup lang="ts">
import { Blocks, Download, Lock, PlayCircle } from 'lucide-vue-next'
import { pmState, type PmSection } from './store'

defineProps<{ compact?: boolean }>()

const items: { id: PmSection; label: string; icon: typeof Blocks }[] = [
  { id: 'all', label: '全部', icon: Blocks },
  { id: 'running', label: '运行中', icon: PlayCircle },
  { id: 'available', label: '可安装', icon: Download },
  { id: 'system', label: '系统', icon: Lock },
]
</script>

<template>
  <div :class="compact ? 'flex gap-2' : 'flex flex-col gap-1'">
    <p v-if="!compact" class="px-2 pb-2 text-xs font-medium text-ink-2">分类</p>
    <button
      v-for="it in items"
      :key="it.id"
      type="button"
      class="flex items-center gap-2.5 text-sm transition-all duration-micro cursor-pointer"
      :class="[
        compact ? 'h-8 shrink-0 rounded-full px-3' : 'rounded-xl px-3 py-2',
        pmState.section === it.id ? 'bg-brand/15 text-brand' : 'text-ink-1 hover:bg-glass',
      ]"
      @click="pmState.section = it.id"
    >
      <component :is="it.icon" :size="compact ? 13 : 15" />
      {{ it.label }}
    </button>
  </div>
</template>
