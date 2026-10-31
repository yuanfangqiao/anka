<script setup lang="ts">
import { computed, inject } from 'vue'
import { APP_RUNTIME_KEY } from './contracts'
import { appRuntime } from './appRuntime'

withDefaults(defineProps<{ to?: string }>(), { to: 'body' })
const owner = inject<string>(APP_RUNTIME_KEY, '')
const visible = computed(() => !owner || Boolean(appRuntime.runs.get(owner)?.visible))
</script>

<template>
  <Teleport :to="to">
    <div :style="{ display: visible ? 'contents' : 'none' }" :inert="!visible" :data-app-portal="owner"><slot /></div>
  </Teleport>
</template>
