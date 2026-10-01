<script setup lang="ts">
/**
 * TrendShift（GitHub 趋势/热榜聚合）iframe 内嵌。
 * 实测该站未设 X-Frame-Options/frame-ancestors，可嵌。
 */
import { ref } from 'vue'

const url = ref('https://trendshift.io/')
const key = ref(0)

function reload() {
  key.value++
}
function openExternal() {
  window.open(url.value, '_blank', 'noopener')
}
</script>

<template>
  <div class="flex h-full flex-col p-3">
    <div class="min-h-0 flex-1 overflow-hidden rounded-2xl border border-line bg-bg-1">
      <!--
        sandbox 白名单：只给脚本与同源存储（站点能正常运行），
        不给 allow-popups（拦截新开页）、不给 allow-top-navigation（顶层 PWA 不可被导航走）。
        效果：站内详情在 iframe 内打开（作为当前应用）；GitHub 外链点击不再跳出 PWA。
        需要打开外链时：右键 → 在新标签页打开（浏览器级导航不受 sandbox 弹窗限制），
        或点工具条「新窗口打开」。
      -->
      <iframe
        :key="key"
        :src="url"
        title="TrendShift 趋势榜"
        class="h-full w-full border-0"
        referrerpolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-forms"
      ></iframe>
    </div>
  </div>
</template>
