<script setup lang="ts">
/**
 * M17.12：首页设置 —— 选择打开应用时首先进入的应用。
 * 候选 = 全部 dock 应用（静态注册的系统应用 + 插件动态注册）+ 「默认」清除项。
 * 偏好存后端 settings.json，改动经 settings-changed 广播同步其他终端。
 */
import { computed, onMounted, ref } from 'vue'
import { Check, MessageSquare } from 'lucide-vue-next'
import { useBreakpoint } from '../../../composables/useBreakpoint'
import { registry } from '../../../registry/appRegistry'
import { ensureHomeApp, homeApp, setHomeApp } from '../useHomeApp'

const { isMobile } = useBreakpoint()
const saving = ref('')

onMounted(ensureHomeApp)

interface HomeOption {
  id: string | null
  title: string
  desc: string
  icon: unknown
  system: boolean
}

const options = computed<HomeOption[]>(() => [
  {
    id: null,
    title: '默认',
    desc: '打开即进入对话（未设置偏好）',
    icon: MessageSquare,
    system: true,
  },
  ...registry.dockApps.value.map((a) => ({
    id: a.id as string | null,
    title: a.title,
    desc: `${a.system ? '系统应用' : '应用插件'} · ${a.route}`,
    icon: registry.resolveIcon(a.icon),
    system: a.system,
  })),
])

const isSelected = (id: string | null) => (homeApp.value ?? null) === (id ?? null)

async function pick(opt: HomeOption) {
  if (saving.value) return
  saving.value = opt.id ?? ''
  try {
    await setHomeApp(opt.id, opt.title)
  } finally {
    saving.value = ''
  }
}
</script>

<template>
  <section class="space-y-2">
    <p class="px-1 text-xs font-medium text-ink-2">启动页</p>
    <div class="stagger overflow-hidden rounded-2xl border border-line bg-glass">
      <button
        v-for="(opt, i) in options"
        :key="String(opt.id)"
        type="button"
        class="flex w-full cursor-pointer items-center gap-3 px-3.5 text-left transition-colors duration-micro hover:bg-bg-2"
        :class="[
          i > 0 ? 'border-t border-line' : '',
          isMobile ? 'h-[52px]' : 'h-12',
          isSelected(opt.id) ? 'bg-brand/10' : '',
        ]"
        @click="pick(opt)"
      >
        <span
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          :class="opt.system
            ? 'bg-gradient-to-br from-brand to-brand-cyan text-white'
            : 'bg-bg-2 text-ink-1'"
        >
          <component :is="opt.icon" :size="16" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-medium text-ink-0">{{ opt.title }}</span>
          <span class="block truncate text-[11px] text-ink-2">{{ opt.desc }}</span>
        </span>
        <span
          v-if="saving === (opt.id ?? '')"
          class="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-brand/30 border-t-brand"
        />
        <span
          v-else-if="isSelected(opt.id)"
          class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand text-white"
        >
          <Check :size="12" />
        </span>
        <span v-else class="h-5 w-5 shrink-0 rounded-full border border-line" />
      </button>
    </div>
    <p class="px-1 text-[11px] leading-relaxed text-ink-2">
      设为首页的应用若被卸载，启动时自动回退到对话；该设置跟随账号，所有终端同步。
    </p>
  </section>
</template>
