<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { isMobile } from '../composables/useBreakpoint'
import { appRuntime } from './appRuntime'
import ApplicationSurface from './ApplicationSurface.vue'

const route = useRoute()
const runs = computed(() => appRuntime.running.value.filter(run => !run.parentId))
const split = computed(() => appRuntime.state.split && !isMobile.value && Boolean(appRuntime.state.secondaryId))
const shown = (id: string) => id === appRuntime.state.focusedId || (split.value && id === appRuntime.state.secondaryId)
</script>

<template>
  <div class="relative flex h-full min-h-0 w-full" :data-workspace="split ? 'split' : 'single'">
    <!-- Stable parent and keyed nodes: never detach or reparent a live iframe. -->
    <section v-for="run in runs" :key="run.key" v-show="shown(run.id)"
      class="relative h-full min-w-0 flex-1 overflow-y-auto"
      :class="split ? 'border-r border-line last:border-r-0' : ''"
      :aria-hidden="!shown(run.id)" :inert="!shown(run.id)"
      :data-app-window="run.id" @pointerdown.capture="run.id !== appRuntime.state.focusedId && appRuntime.open(run.id)">
      <ApplicationSurface :run="run" />
    </section>
    <RouterView v-if="!route.meta.appId" />
  </div>
</template>
