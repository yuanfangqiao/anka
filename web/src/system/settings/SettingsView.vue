<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Blocks, Download, Info, Moon, Sun, Waves } from 'lucide-vue-next'
import AppFrame from '../../components/AppFrame.vue'
import BaseCard from '../../components/ui/BaseCard.vue'
import BaseSwitch from '../../components/ui/BaseSwitch.vue'
import { useTheme } from '../../composables/useTheme'
import { useBreakpoint } from '../../composables/useBreakpoint'

const router = useRouter()
const { theme, setTheme } = useTheme()
const { isMobile } = useBreakpoint()

const dark = computed({
  get: () => theme.value === 'dark',
  set: (v: boolean) => setTheme(v ? 'dark' : 'light'),
})

const standalone = ref(false)
onMounted(() => {
  standalone.value =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
})
</script>

<template>
  <AppFrame>
    <div class="flex flex-col gap-4 pb-2">
      <header class="pt-2">
        <h1 class="text-[30px] font-bold tracking-tight">设置</h1>
        <p class="mt-1 text-sm text-ink-2">外观、安装状态与关于</p>
      </header>

      <section class="space-y-2">
        <p class="px-1 text-xs font-medium text-ink-2">外观</p>
        <BaseCard class="flex items-center gap-3 !p-4">
          <span class="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand/15 text-brand">
            <Moon v-if="dark" :size="18" />
            <Sun v-else :size="18" />
          </span>
          <div class="flex-1">
            <p class="text-sm font-medium">暗色主题</p>
            <p class="mt-0.5 text-[11px] text-ink-2">暗色优先的玻璃拟态，亮色为备选</p>
          </div>
          <BaseSwitch v-model="dark" />
        </BaseCard>
        <BaseCard class="flex items-center gap-3 !p-4 opacity-60">
          <span class="flex h-10 w-10 items-center justify-center rounded-2xl bg-bg-2 text-ink-1">
            <Waves :size="18" />
          </span>
          <div class="flex-1">
            <p class="text-sm font-medium">外观密度</p>
            <p class="mt-0.5 text-[11px] text-ink-2">紧凑 / 舒适 —— 后续版本提供</p>
          </div>
        </BaseCard>
      </section>

      <section class="space-y-2">
        <p class="px-1 text-xs font-medium text-ink-2">管理</p>
        <BaseCard
          class="flex cursor-pointer items-center gap-3 !p-4 transition-all duration-micro hover:border-brand/30"
          @click="router.push('/plugins-manager')"
        >
          <span class="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-cyan/15 text-brand-cyan">
            <Blocks :size="18" />
          </span>
          <div class="flex-1">
            <p class="text-sm font-medium">插件管理</p>
            <p class="mt-0.5 text-[11px] text-ink-2">查看依赖、热启停、安装与卸载</p>
          </div>
          <span class="text-ink-2">›</span>
        </BaseCard>
      </section>

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

      <section class="space-y-2">
        <p class="px-1 text-xs font-medium text-ink-2">关于</p>
        <BaseCard class="!p-4">
          <div class="flex items-center gap-3">
            <span class="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-brand-cyan font-bold text-white shadow-glow">A</span>
            <div>
              <p class="text-sm font-semibold">AgentOS · PWA Agent 样例</p>
              <p class="mt-0.5 text-[11px] text-ink-2">v0.1.0 · M1 双布局壳 + PWA</p>
            </div>
          </div>
          <p class="mt-3 flex items-start gap-2 text-[12px] leading-relaxed text-ink-1">
            <Info :size="13" class="mt-0.5 shrink-0 text-brand" />
            一切皆插件的 Agent 演示：后端 cordis 内核（Service 仓库 / inject 拓扑 / 五种事件分发 / 可逆副作用），前端应用注册表驱动的双布局壳。
          </p>
        </BaseCard>
      </section>
    </div>
  </AppFrame>
</template>
