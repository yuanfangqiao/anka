<script setup lang="ts">
/**
 * M17.11：客户端设置 —— PWA 安装状态（自原 SettingsView 抽取）
 * + 版本与更新卡（展示 __APP_BUILD__，手动触发 M17.10 版本巡检）。
 */
import { onMounted, ref } from 'vue'
import { Download, RefreshCw } from 'lucide-vue-next'
import BaseCard from '../../../components/ui/BaseCard.vue'
import { useToast } from '../../../composables/useToast'
import { checkForUpdatesNow } from '../../../system/useAppUpdate'

const toast = useToast()
const standalone = ref(false)
const checking = ref(false)
const build = __APP_BUILD__

onMounted(() => {
  standalone.value =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
})

async function checkNow() {
  if (checking.value) return
  checking.value = true
  try {
    const found = await checkForUpdatesNow()
    // found → 更新横幅（UpdateNotice）已弹出，不再 toast
    if (!found) toast.ok('已是最新版本')
  } finally {
    checking.value = false
  }
}
</script>

<template>
  <section class="space-y-2">
    <p class="px-1 text-xs font-medium text-ink-2">PWA</p>
    <BaseCard class="flex items-center gap-3 !p-4">
      <span class="flex h-10 w-10 items-center justify-center rounded-2xl bg-ok/15 text-ok">
        <Download :size="18" />
      </span>
      <div class="flex-1">
        <p class="text-sm font-medium">安装状态</p>
        <p class="mt-0.5 text-[11px] text-ink-2">
          {{ standalone ? '已安装为独立应用' : '浏览器访问中——可从地址栏安装到桌面/主屏幕' }}
        </p>
      </div>
      <span
        class="rounded-full px-2.5 py-1 text-[11px]"
        :class="standalone ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn'"
      >
        {{ standalone ? '已安装' : '未安装' }}
      </span>
    </BaseCard>
    <BaseCard class="flex items-center gap-3 !p-4">
      <span class="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand/15 text-brand">
        <RefreshCw :size="18" :class="checking ? 'animate-spin' : ''" />
      </span>
      <div class="flex-1">
        <p class="text-sm font-medium">版本与更新</p>
        <p class="mt-0.5 text-[11px] text-ink-2">
          当前 {{ build }} · 有新版本时顶部会弹出更新提示
        </p>
      </div>
      <button
        type="button"
        :disabled="checking"
        class="h-8 cursor-pointer rounded-xl border border-line bg-glass px-3 text-xs text-ink-1 transition-all duration-micro hover:border-brand/40 hover:text-ink-0 active:scale-95 disabled:opacity-50"
        @click="checkNow"
      >
        {{ checking ? '检查中…' : '检查更新' }}
      </button>
    </BaseCard>
  </section>
</template>
