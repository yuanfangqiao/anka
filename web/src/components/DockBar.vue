<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { registry } from '../registry/appRegistry'
import { api } from '../services/api'

defineProps<{ desktop?: boolean }>()

const route = useRoute()
const router = useRouter()
const { dockApps, resolveIcon } = registry

// 手机 dock 最多可见应用数（内核 /api/config 下发，超出横滑）
const maxVisible = ref(5)
onMounted(async () => {
  try {
    maxVisible.value = (await api.config()).mobile_dock_max ?? 5
  } catch { /* 后端离线时用默认值 */ }
})

function isActive(path: string) {
  return route.path === path
}
</script>

<template>
  <nav
    class="glass-panel z-40 rounded-[22px] shadow-card"
    :class="desktop ? 'relative h-[58px] px-2.5 py-1.5' : 'fixed inset-x-3 bottom-2 h-[46px] safe-bottom px-1 py-1'"
    aria-label="应用 Dock"
  >
    <div
      class="dock-scroll flex h-full items-center overflow-x-auto"
      :class="desktop ? 'max-w-[460px] gap-1.5' : ''"
    >
      <div
        v-for="app in dockApps"
        :key="app.id"
        class="group relative flex flex-col items-center"
        :class="desktop ? 'shrink-0' : ''"
        :style="desktop ? undefined : `flex: 1 0 ${100 / maxVisible}%`"
      >
        <div
          class="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg bg-bg-2 px-2.5 py-1 text-[11px] text-ink-0 opacity-0 shadow-card transition-opacity duration-micro group-hover:opacity-100"
          :class="desktop ? '' : 'hidden'"
        >
          {{ app.title }}
        </div>

        <button
          type="button"
          class="flex items-center justify-center transition-transform duration-micro active:scale-90 cursor-pointer"
          :aria-current="isActive(app.route) ? 'page' : undefined"
          :aria-label="app.title"
          @click="router.push(app.route)"
        >
          <span
            class="flex items-center justify-center rounded-[30%] bg-gradient-to-br from-brand to-brand-cyan text-white shadow-md shadow-brand/25"
            :class="desktop ? 'h-9 w-9' : 'h-8 w-8'"
          >
            <component :is="resolveIcon(app.icon)" :size="desktop ? 18 : 16" />
          </span>
        </button>

        <span
          class="pointer-events-none mt-[3px] h-[3px] w-[3px] rounded-full transition-all duration-micro"
          :class="isActive(app.route) ? 'bg-gradient-to-r from-brand to-brand-cyan' : 'bg-transparent'"
        ></span>
      </div>
    </div>

    <div
      v-if="dockApps.length > maxVisible"
      class="pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-[22px] bg-gradient-to-l from-bg-1/90 to-transparent"
      aria-hidden="true"
    ></div>
  </nav>
</template>

<style scoped>
.dock-scroll {
  scrollbar-width: none;
}
.dock-scroll::-webkit-scrollbar {
  display: none;
}
</style>
