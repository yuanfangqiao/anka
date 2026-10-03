<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import TopBar from '../components/TopBar.vue'
import DockBar from '../components/DockBar.vue'

const route = useRoute()

// page 类应用全屏运行：不渲染顶部栏、不留任何空位（含 safe-area）——
// dock 之上整块区域完全归应用自己，插件自行管理自己的安全区
const fullscreen = computed(() => Boolean(route.meta.fullscreen))

const collapsed = ref(false)

function onScroll(e: Event) {
  collapsed.value = (e.target as HTMLElement).scrollTop > 44
}
</script>

<template>
  <div class="relative flex h-dvh flex-col">
    <TopBar v-if="!fullscreen" :collapsed="collapsed" />
    <main
      class="relative flex-1 overflow-y-auto pb-[calc(88px+env(safe-area-inset-bottom,0px))]"
      :class="fullscreen ? '' : 'pt-14'"
      @scroll.passive="onScroll"
    >
      <RouterView v-slot="{ Component }">
        <Transition name="page">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>
    <DockBar />
  </div>
</template>
