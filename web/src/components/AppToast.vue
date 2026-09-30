<script setup lang="ts">
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-vue-next'
import { useToast } from '../composables/useToast'

const { items } = useToast()

const icons = { ok: CheckCircle2, warn: AlertTriangle, err: XCircle }
const colors = { ok: 'text-ok', warn: 'text-warn', err: 'text-err' }
</script>

<template>
  <div class="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4">
    <TransitionGroup name="page">
      <div
        v-for="t in items"
        :key="t.id"
        class="glass-panel flex max-w-sm items-center gap-2 rounded-2xl px-4 py-2.5 text-sm shadow-card"
      >
        <component :is="icons[t.kind]" :size="16" :class="colors[t.kind]" />
        <span class="text-ink-0">{{ t.text }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>
