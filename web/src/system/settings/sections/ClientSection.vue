<script setup lang="ts">
/**
 * M17.11：客户端设置 —— PWA 安装状态 + 版本与更新卡。
 * M17.13：更新控制组 —— 自动检查开关（localStorage 持久，默认关）
 *         / 检查更新（手动，不受开关约束）/ 强制刷新（两步确认，清缓存+reload）。
 */
import { computed, onMounted, ref } from 'vue'
import { AlertTriangle, Bell, Download, RefreshCw } from 'lucide-vue-next'
import BaseCard from '../../../components/ui/BaseCard.vue'
import BaseSwitch from '../../../components/ui/BaseSwitch.vue'
import { useToast } from '../../../composables/useToast'
import { autoUpdate, checkForUpdatesNow, forceRefresh, setAutoUpdate } from '../../../system/useAppUpdate'

const toast = useToast()
const standalone = ref(false)
const checking = ref(false)
const build = __APP_BUILD__

const auto = computed({ get: () => autoUpdate.value, set: setAutoUpdate })

const confirmingForce = ref(false)
let forceTimer: number | undefined

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

function clickForce() {
  if (!confirmingForce.value) {
    confirmingForce.value = true
    forceTimer = window.setTimeout(() => { confirmingForce.value = false }, 3000)
    return
  }
  window.clearTimeout(forceTimer)
  void forceRefresh()
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
  </section>

  <section class="mt-4 space-y-2">
    <p class="px-1 text-xs font-medium text-ink-2">更新</p>
    <BaseCard class="flex items-center gap-3 !p-4">
      <span class="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand/15 text-brand">
        <RefreshCw :size="18" :class="checking ? 'animate-spin' : ''" />
      </span>
      <div class="flex-1">
        <p class="text-sm font-medium">版本与更新</p>
        <p class="mt-0.5 text-[11px] text-ink-2">当前 {{ build }}</p>
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
    <BaseCard class="flex items-center gap-3 !p-4">
      <span class="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-cyan/15 text-brand-cyan">
        <Bell :size="18" />
      </span>
      <div class="flex-1">
        <p class="text-sm font-medium">自动检查更新</p>
        <p class="mt-0.5 text-[11px] text-ink-2">
          开启后切回前台/每分钟自动检查并提示；关闭则只在手动检查时提示
        </p>
      </div>
      <BaseSwitch v-model="auto" />
    </BaseCard>
    <BaseCard class="flex items-center gap-3 !p-4">
      <span class="flex h-10 w-10 items-center justify-center rounded-2xl bg-warn/15 text-warn">
        <AlertTriangle :size="18" />
      </span>
      <div class="flex-1">
        <p class="text-sm font-medium">强制刷新</p>
        <p class="mt-0.5 text-[11px] text-ink-2">
          清空本机缓存并完整重载——更新异常时的一键自救；本机设置不会丢失
        </p>
      </div>
      <button
        type="button"
        class="h-8 shrink-0 cursor-pointer rounded-xl border px-3 text-xs transition-all duration-micro active:scale-95"
        :class="confirmingForce
          ? 'border-err/50 bg-err/15 font-medium text-err'
          : 'border-line bg-glass text-ink-1 hover:border-err/40 hover:text-err'"
        @click="clickForce"
      >
        {{ confirmingForce ? '再次点击确认' : '强制刷新' }}
      </button>
    </BaseCard>
  </section>
</template>
