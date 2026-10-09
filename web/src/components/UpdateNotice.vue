<script setup lang="ts">
/**
 * M17.10：PWA 更新提示横幅（DeepSeek 式顶部胶囊）。
 * 三种来源同一形态：「发现新版本 / 前端已更新 / 服务端已更新，点击更新」。
 * 位置在 BackgroundTaskIndicator（top≈10px + 高≈34px）之下，避免同屏重叠；
 * z 层级低于 CreateModeOverlay（z-[100]），高于常规内容与后台任务指示条。
 */
import { RefreshCw, X } from 'lucide-vue-next'
import { useAppUpdate } from '../system/useAppUpdate'

const { available, label, apply, dismiss } = useAppUpdate()
</script>

<template>
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="-translate-y-3 opacity-0"
    enter-to-class="translate-y-0 opacity-100"
    leave-active-class="transition duration-150 ease-in"
    leave-from-class="translate-y-0 opacity-100"
    leave-to-class="-translate-y-3 opacity-0"
  >
    <div
      v-if="available"
      role="alert"
      class="fixed left-1/2 z-[80] flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-2.5 rounded-2xl border border-[var(--line)] bg-[var(--glass)] px-3 py-2 text-sm text-ink-0 shadow-xl shadow-black/30 backdrop-blur-md"
      style="top: calc(env(safe-area-inset-top, 0px) + 3rem)"
    >
      <RefreshCw class="h-4 w-4 shrink-0 animate-spin text-brand" style="animation-duration: 3s" />
      <span class="whitespace-nowrap">{{ label }}，点击更新</span>
      <button
        type="button"
        class="cursor-pointer rounded-lg bg-brand px-2.5 py-1 text-xs font-medium text-white transition hover:opacity-90 active:scale-95"
        @click="apply()"
      >
        更新
      </button>
      <button
        type="button"
        class="cursor-pointer rounded-lg p-1 opacity-60 transition hover:opacity-100"
        title="稍后"
        aria-label="稍后"
        @click="dismiss()"
      >
        <X class="h-3.5 w-3.5" />
      </button>
    </div>
  </Transition>
</template>
