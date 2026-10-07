<script setup lang="ts">
import { onMounted } from 'vue'
import MobileShell from './layouts/MobileShell.vue'
import DesktopShell from './layouts/DesktopShell.vue'
import AppToast from './components/AppToast.vue'
import BackgroundTaskIndicator from './components/BackgroundTaskIndicator.vue'
import CreateModeOverlay from './components/CreateModeOverlay.vue'
import { useBreakpoint } from './composables/useBreakpoint'
import { useTheme } from './composables/useTheme'
import { bindCreateModeGestures } from './composables/useCreateMode'
import { useChat } from './system/chat/useChat'

const { isMobile } = useBreakpoint()
const { apply } = useTheme()
const { restoreRuns } = useChat()

onMounted(() => {
  apply()
  bindCreateModeGestures()
  // 刷新/PWA 重启后无论落在哪个页面，都重挂服务端仍在执行的 run（M17）
  restoreRuns()
})
</script>

<template>
  <!-- fixed inset-0 钉死视口（M17 安卓刷新拉伸修复）：根容器不依赖 dvh 计算、
       文档流不可滚动——页面在结构上不可能比屏幕长，dock 不可能被推出视口 -->
  <div class="fixed inset-0 w-full overflow-hidden bg-bg-0 text-ink-0 font-sans antialiased">
    <div class="pointer-events-none fixed inset-0" aria-hidden="true">
      <div class="absolute -top-32 -left-24 h-96 w-96 rounded-full bg-brand/15 blur-[120px]"></div>
      <div class="absolute -bottom-40 -right-16 h-[28rem] w-[28rem] rounded-full bg-brand-cyan/10 blur-[140px]"></div>
    </div>
    <MobileShell v-if="isMobile" />
    <DesktopShell v-else />
    <AppToast />
    <BackgroundTaskIndicator />
    <CreateModeOverlay />
  </div>
</template>
