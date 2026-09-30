<script setup lang="ts">
import DockBar from '../components/DockBar.vue'
</script>

<template>
  <!-- 主界面 = 上下两部分：应用区 + dock；无标题条，App 占满整个窗口 -->
  <div class="relative flex h-dvh flex-col gap-2.5 p-3">
    <main class="glass-panel relative min-h-0 flex-1 overflow-y-auto rounded-2xl shadow-card">
      <RouterView v-slot="{ Component }">
        <Transition name="page">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>

    <div class="flex shrink-0 justify-center">
      <DockBar desktop />
    </div>
  </div>
</template>
