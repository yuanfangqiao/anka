<script setup lang="ts">
import { computed, inject, onUnmounted, ref, watch } from 'vue'
import { APP_RUNTIME_KEY } from './contracts'
import { appRuntime } from './appRuntime'
import ApplicationSurface from './ApplicationSurface.vue'

const props = defineProps<{ appId: string }>()
const parentId = inject<string>(APP_RUNTIME_KEY)
const run = computed(() => appRuntime.runs.get(props.appId))
const error = ref('')
let generation = 0
watch(() => props.appId, async (id, previous) => {
  const current = ++generation
  if (previous && appRuntime.runs.get(previous)?.parentId === parentId) appRuntime.remove(previous)
  error.value = ''
  try {
    if (!parentId) throw new Error('AppEmbed 必须在应用中使用')
    await appRuntime.embed(id, parentId)
  } catch (e) { if (current === generation) error.value = String(e) }
}, { immediate: true })
onUnmounted(() => { generation++; if (run.value?.parentId === parentId) appRuntime.remove(props.appId) })
</script>

<template>
  <div class="h-full min-h-0 w-full" data-app-embed>
    <p v-if="error" role="alert" class="p-4 text-sm text-ink-2">{{ error }}</p>
    <ApplicationSurface v-else-if="run" :key="run.key" :run="run" />
  </div>
</template>
