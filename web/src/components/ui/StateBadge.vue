<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ state: string }>()

const map: Record<string, { label: string; cls: string; dot: string }> = {
  ACTIVE: { label: '运行中', cls: 'bg-ok/15 text-ok', dot: 'bg-ok' },
  PENDING: { label: '待依赖', cls: 'bg-warn/15 text-warn', dot: 'bg-warn' },
  LOADING: { label: '加载中', cls: 'bg-brand/15 text-brand', dot: 'bg-brand' },
  FAILED: { label: '失败', cls: 'bg-err/15 text-err', dot: 'bg-err' },
  DISPOSED: { label: '已卸载', cls: 'bg-bg-2 text-ink-2', dot: 'bg-ink-2' },
  UNLOADING: { label: '卸载中', cls: 'bg-warn/15 text-warn', dot: 'bg-warn' },
}

const info = computed(() => map[props.state] ?? map.PENDING)
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
    :class="info.cls"
  >
    <span class="h-1.5 w-1.5 rounded-full" :class="[info.dot, state === 'ACTIVE' ? 'animate-pulse-dot' : '']"></span>
    {{ info.label }}
  </span>
</template>
