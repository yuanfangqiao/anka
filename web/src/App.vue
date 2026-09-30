<script setup lang="ts">
import { onMounted } from 'vue'
import MobileShell from './layouts/MobileShell.vue'
import DesktopShell from './layouts/DesktopShell.vue'
import AppToast from './components/AppToast.vue'
import { useBreakpoint } from './composables/useBreakpoint'
import { useTheme } from './composables/useTheme'

const { isMobile } = useBreakpoint()
const { apply } = useTheme()

onMounted(apply)
</script>

<template>
  <div class="h-dvh w-full overflow-hidden bg-bg-0 text-ink-0 font-sans antialiased">
    <div class="pointer-events-none fixed inset-0" aria-hidden="true">
      <div class="absolute -top-32 -left-24 h-96 w-96 rounded-full bg-brand/15 blur-[120px]"></div>
      <div class="absolute -bottom-40 -right-16 h-[28rem] w-[28rem] rounded-full bg-brand-cyan/10 blur-[140px]"></div>
    </div>
    <MobileShell v-if="isMobile" />
    <DesktopShell v-else />
    <AppToast />
  </div>
</template>
