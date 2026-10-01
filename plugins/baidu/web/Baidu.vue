<script setup lang="ts">
/**
 * 百度搜索（纯净模式）：后端代理 m.baidu.com（手机版）+ 删除全部 <script>——
 * feed 流/广告/红包弹层全靠 JS 渲染，删掉后只剩 logo + 搜索框，天然纯净且适配手机。
 * 搜索表单提交后正常跳百度结果页。
 */
import { onMounted, ref } from 'vue'
import type { UiCtx } from './types'

const props = defineProps<{ uiCtx: UiCtx }>()

const homeHtml = ref('')
const failed = ref(false)

onMounted(async () => {
  try {
    const s = await props.uiCtx.api.getAppState<{ home_html: string }>('baidu')
    homeHtml.value = s.home_html ?? ''
    if (!homeHtml.value) failed.value = true
  } catch {
    failed.value = true
  }
})
</script>

<template>
  <div class="h-full">
    <iframe
      v-if="homeHtml"
      :srcdoc="homeHtml"
      title="百度搜索"
      class="h-full w-full border-0 bg-white"
      referrerpolicy="no-referrer"
    ></iframe>
    <div
      v-else
      class="flex h-full flex-col items-center justify-center gap-3 text-sm text-ink-2"
    >
      <template v-if="failed">
        <span>纯净首页不可用</span>
        <a
          href="https://m.baidu.com/"
          target="_blank"
          rel="noopener"
          class="text-brand underline"
          >新窗口打开百度</a
        >
      </template>
      <span v-else>正在加载…</span>
    </div>
  </div>
</template>
