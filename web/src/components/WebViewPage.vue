<script setup lang="ts">
import { inject, onMounted, onUnmounted, ref } from 'vue'
import { attachFrameBridge } from '../runtime/frameBridge'
import { APP_RUNTIME_KEY } from '../runtime/contracts'
/**
 * 通用 WebView 页（M11）：plugins/ 下任意静态页目录的运行时载体。
 * page 类应用没有 setup(uiCtx)，内核直接用本组件包裹其静态入口。
 * iframe 与宿主同源 → 页面内可直接 fetch('/api/...') 调内核能力。
 * 不加 sandbox：同源下 allow-scripts+allow-same-origin 本就无隔离收益，
 * 反而会拦掉第三方 SPA 的 SW 注册/剪贴板/弹窗等能力导致白屏。
 */
const props = defineProps<{ entry: string; title?: string; appId?: string }>()
const owner = inject<string>(APP_RUNTIME_KEY, '')
const frame = ref<HTMLIFrameElement>()
let stop: (() => void) | undefined
onMounted(() => { if (frame.value && (props.appId || owner)) stop = attachFrameBridge(frame.value, props.appId || owner) })
onUnmounted(() => stop?.())
</script>

<template>
  <div class="h-full w-full bg-white">
    <iframe
      ref="frame"
      :src="entry"
      :title="title ?? 'WebView'"
      class="h-full w-full border-0"
      referrerpolicy="no-referrer"
    ></iframe>
  </div>
</template>
