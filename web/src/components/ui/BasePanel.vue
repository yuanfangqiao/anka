<script setup lang="ts">
/** App 自绘左栏的统一容器（内核只提供样式，不负责布局归属） */
defineProps<{ title?: string }>()
</script>

<template>
  <section class="glass-panel flex h-full min-h-0 flex-col rounded-2xl shadow-card">
    <p v-if="title" class="px-3 pb-2 pt-1 text-xs font-medium text-ink-2">{{ title }}</p>
    <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      <slot />
    </div>
  </section>
</template>
