<script setup lang="ts">
import { computed } from 'vue'
import { appRuntime } from '../../runtime/appRuntime'

const props = defineProps<{ appId: string; active: boolean }>()
const state = computed(() => props.active ? 'active' : appRuntime.runs.has(props.appId) ? 'background' : 'closed')
</script>

<template>
  <span class="pointer-events-none block h-[3px] shrink-0 rounded-full transition-all duration-micro"
    :class="state === 'active' ? 'w-3 bg-gradient-to-r from-brand to-brand-cyan' : state === 'background' ? 'w-[3px] bg-ink-2' : 'w-[3px] bg-transparent'"
    :data-dock-indicator="appId" :data-state="state" aria-hidden="true"></span>
</template>
