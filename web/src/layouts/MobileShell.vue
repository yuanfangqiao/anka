<script setup lang="ts">
import { ref } from 'vue'
import TopBar from '../components/TopBar.vue'
import DockBar from '../components/DockBar.vue'

const collapsed = ref(false)

function onScroll(e: Event) {
  collapsed.value = (e.target as HTMLElement).scrollTop > 44
}
</script>

<template>
  <div class="relative flex h-dvh flex-col">
    <TopBar :collapsed="collapsed" />
    <main
      class="relative flex-1 overflow-y-auto pt-14 pb-[calc(54px+env(safe-area-inset-bottom))]"
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
