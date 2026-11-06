<script setup lang="ts">
import { MousePointer2 } from 'lucide-vue-next'
import { useToast } from '../../composables/useToast'
import { connectWebUse, stopWebUse, webUseEnabled, webUseStatus } from '../../runtime/webUse/client'

const { warn } = useToast()

async function toggle() {
  if (webUseEnabled.value) { stopWebUse(); return }
  webUseEnabled.value = true
  try { await connectWebUse() }
  catch (error) {
    if (webUseEnabled.value) {
      stopWebUse()
      warn(error instanceof Error ? error.message : '网页操作连接失败')
    }
  }
}
</script>

<template>
  <button type="button" class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[11px] cursor-pointer"
    :class="webUseEnabled ? 'border-brand/40 bg-brand/15 text-brand' : 'border-line text-ink-1 hover:text-ink-0'"
    :aria-pressed="webUseEnabled" aria-label="网页操作"
    title="开启后，发送的对话可操作当前 Anka 窗口内的插件"
    @click="toggle">
    <MousePointer2 :size="13" aria-hidden="true" />
    {{ webUseStatus === 'connecting' ? '连接中…' : webUseEnabled ? '网页操作已开' : '网页操作' }}
  </button>
</template>
