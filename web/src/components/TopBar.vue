<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronLeft } from 'lucide-vue-next'
import { registry } from '../registry/appRegistry'

const props = defineProps<{ collapsed: boolean }>()

const route = useRoute()
const router = useRouter()

const title = computed(() => (route.meta.title as string) ?? '')
const appId = computed(() => route.meta.appId as string | undefined)
const currentApp = computed(() => registry.apps.find((a) => a.id === appId.value))

/** 设置已进 dock；仅非 dock 系统页（插件管理）显示返回 */
const showBack = computed(() => Boolean(currentApp.value && !currentApp.value.inDock))

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/')
}
</script>

<template>
  <header
    class="safe-top fixed inset-x-0 top-0 z-40 flex h-14 items-center px-3 glass-panel border-x-0 border-t-0"
  >
    <div class="flex w-16 items-center">
      <button
        v-if="showBack"
        type="button"
        class="flex h-9 items-center gap-0.5 rounded-full px-2 text-brand transition-transform duration-micro hover:bg-glass active:scale-95 cursor-pointer"
        aria-label="返回"
        @click="goBack"
      >
        <ChevronLeft :size="20" />
        <span class="text-sm">返回</span>
      </button>
    </div>

    <h2
      class="absolute left-1/2 -translate-x-1/2 text-[15px] font-semibold tracking-wide transition-all duration-micro"
      :class="props.collapsed ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'"
    >
      {{ title }}
    </h2>
  </header>
</template>
