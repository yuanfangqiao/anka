<script setup lang="ts">
/** M17.11：主题快捷切换（控制台主页右上角；日/月图标旋转微动画） */
import { computed } from 'vue'
import { Moon, Sun } from 'lucide-vue-next'
import { useTheme } from '../composables/useTheme'

const { theme, setTheme } = useTheme()
const dark = computed(() => theme.value === 'dark')

function toggle() {
  setTheme(dark.value ? 'light' : 'dark')
}
</script>

<template>
  <button
    type="button"
    :aria-label="dark ? '切换到亮色主题' : '切换到暗色主题'"
    :title="dark ? '切换到亮色主题' : '切换到暗色主题'"
    class="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-line bg-glass text-ink-1 transition-all duration-micro hover:border-brand/40 hover:text-ink-0 active:scale-90"
    @click="toggle"
  >
    <Transition name="theme-icon" mode="out-in">
      <Moon v-if="dark" key="moon" :size="16" />
      <Sun v-else key="sun" :size="16" />
    </Transition>
  </button>
</template>

<style scoped>
.theme-icon-enter-active,
.theme-icon-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}
.theme-icon-enter-from {
  opacity: 0;
  transform: rotate(-40deg) scale(0.6);
}
.theme-icon-leave-to {
  opacity: 0;
  transform: rotate(40deg) scale(0.6);
}
</style>
