<script setup lang="ts">
import { computed, provide } from 'vue'
import { useDock } from './dock/useDock'
import { DOCK_CONTEXT } from './dock/dockContext'
import DesktopDock from './dock/DesktopDock.vue'
import MobileDock from './dock/MobileDock.vue'
import DockMenu from './dock/DockMenu.vue'

const props = defineProps<{ desktop?: boolean }>()
const dock = useDock(props)
provide(DOCK_CONTEXT, dock)
const { dockApps, expanded, minimized, dockScale } = dock
const baseHeight = computed(() => minimized.value ? 22 : props.desktop ? 74 : 72)
</script>

<template>
  <div
    v-if="desktop || dockApps.length"
    class="relative z-40 w-full transition-[height] duration-300 ease-out"
    :style="{ height: baseHeight * dockScale + 'px' }"
  >
    <!-- 遮罩留在缩放层外，始终覆盖整个视口。 -->
    <div
      v-if="expanded"
      class="fixed inset-0 -z-10 bg-black/30 backdrop-blur-[2px]"
      @click="expanded = false"
    ></div>
    <div
      class="absolute inset-x-0 bottom-0 flex items-end origin-bottom"
      :style="{ height: baseHeight + 'px', transform: `scale(${dockScale})` }"
    >
      <DesktopDock v-if="desktop" />
      <MobileDock v-else />
    </div>
    <DockMenu />
  </div>
</template>
