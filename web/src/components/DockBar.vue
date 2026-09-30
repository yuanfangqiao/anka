<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { registry } from '../registry/appRegistry'

defineProps<{ desktop?: boolean }>()

const route = useRoute()
const router = useRouter()
const { dockApps, resolveIcon } = registry

function isActive(path: string) {
  return route.path === path
}
</script>

<template>
  <nav
    class="glass-panel relative z-40 rounded-[22px] shadow-card"
    :class="desktop ? 'h-[58px] px-2.5 py-1.5' : 'fixed inset-x-4 bottom-2.5 h-[56px] safe-bottom px-2 py-1'"
    aria-label="应用 Dock"
  >
    <div
      class="dock-scroll flex h-full items-end overflow-x-auto"
      :class="desktop ? 'max-w-[460px] gap-1.5' : 'gap-1'"
    >
      <div
        v-for="app in dockApps"
        :key="app.id"
        class="group relative flex shrink-0 flex-col items-center"
      >
        <div
          class="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg bg-bg-2 px-2.5 py-1 text-[11px] text-ink-0 opacity-0 shadow-card transition-opacity duration-micro group-hover:opacity-100"
          :class="desktop ? '' : 'hidden'"
        >
          {{ app.title }}
        </div>

        <button
          type="button"
          class="flex flex-col items-center justify-end gap-0.5 transition-transform duration-micro active:scale-90 cursor-pointer"
          :aria-current="isActive(app.route) ? 'page' : undefined"
          :aria-label="app.title"
          @click="router.push(app.route)"
        >
          <span
            class="flex items-center justify-center rounded-[30%] bg-gradient-to-br from-brand to-brand-cyan text-white shadow-md shadow-brand/25"
            :class="desktop ? 'h-9 w-9' : 'h-[22px] w-[22px]'"
          >
            <component :is="resolveIcon(app.icon)" :size="desktop ? 18 : 12" />
          </span>
          <span
            v-if="!desktop"
            class="text-[10px] leading-none transition-colors duration-micro"
            :class="isActive(app.route) ? 'text-ink-0 font-medium' : 'text-ink-2'"
          >{{ app.title }}</span>
        </button>

        <span
          class="pointer-events-none mt-0.5 h-[3px] w-[3px] rounded-full transition-all duration-micro"
          :class="isActive(app.route) ? 'bg-gradient-to-r from-brand to-brand-cyan' : 'bg-transparent'"
        ></span>
      </div>
    </div>

    <div
      v-if="dockApps.length > 5"
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
