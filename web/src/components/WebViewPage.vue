<script setup lang="ts">
/**
 * 通用 WebView 页（M11）：plugins/ 下任意静态页目录的运行时载体。
 * page 类应用没有 setup(uiCtx)，内核直接用本组件包裹其静态入口。
 * iframe 与宿主同源 → 页面内可直接 fetch('/api/...') 调内核能力。
 */
defineProps<{ entry: string; title?: string }>()
</script>

<template>
  <div class="h-full w-full bg-white">
    <iframe
      :src="entry"
      :title="title ?? 'WebView'"
      class="h-full w-full border-0"
      referrerpolicy="no-referrer"
      sandbox="allow-scripts allow-same-origin allow-forms"
    ></iframe>
  </div>
</template>
