<script setup lang="ts">
import DockBar from '../components/DockBar.vue'
</script>

<template>
  <!-- 两段式：上方内容区（独立内滚）+ 下方 dock 专属条——内容永不滑到 dock 背后。
       外边距 0：内容卡四周贴合窗口边缘，仅保留圆角 -->
  <div class="flex h-dvh flex-col">
    <main class="glass-panel relative flex-1 overflow-y-auto rounded-2xl shadow-card">
      <RouterView v-slot="{ Component }">
        <Transition name="page">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>

    <div class="flex h-[74px] shrink-0 items-end justify-center pb-2">
      <DockBar desktop />
    </div>
  </div>
</template>
