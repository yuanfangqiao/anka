<script setup lang="ts">
/** M17.11：外观设置（自原 SettingsView 抽取，逻辑不变） */
import { computed } from 'vue'
import { Moon, Sun, Waves } from 'lucide-vue-next'
import BaseCard from '../../../components/ui/BaseCard.vue'
import BaseSwitch from '../../../components/ui/BaseSwitch.vue'
import { useTheme } from '../../../composables/useTheme'

const { theme, setTheme } = useTheme()

const dark = computed({
  get: () => theme.value === 'dark',
  set: (v: boolean) => setTheme(v ? 'dark' : 'light'),
})
</script>

<template>
  <section class="space-y-2">
    <p class="px-1 text-xs font-medium text-ink-2">主题</p>
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
</template>
