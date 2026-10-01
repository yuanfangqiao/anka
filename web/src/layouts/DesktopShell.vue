<script setup lang="ts">
import DockBar from '../components/DockBar.vue'
</script>

<template>
  <!-- macOS 式：主窗口占满整个区域，dock 悬浮压在窗口下沿之上（两者之间零间隙） -->
  <div class="relative h-dvh p-3">
    <main
      class="glass-panel relative h-full overflow-y-auto rounded-2xl shadow-card pb-[70px]"
    >
      <RouterView v-slot="{ Component }">
        <Transition name="page">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>

    <div class="absolute bottom-5 left-1/2 z-40 -translate-x-1/2">
      <DockBar desktop />
    </div>
  </div>
</template>
