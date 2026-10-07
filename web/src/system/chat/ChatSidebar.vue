<script setup lang="ts">
import { onMounted } from 'vue'
import { MessageSquare, Plus, Trash2 } from 'lucide-vue-next'
import { useChat } from './useChat'

const emit = defineEmits<{ select: [] }>()

const { sessions, activeSessionId, loadSession, startNewSession, removeSession, refreshSessions }
  = useChat()

onMounted(() => { if (!sessions.value.length) refreshSessions() })

function fmt(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (days < 1) return '昨天'
  if (days < 7) return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function pick(id: string) {
  loadSession(id)
  emit('select')
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <button
      type="button"
      class="mb-2 flex h-9 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-brand to-brand-cyan text-[13px] font-medium text-white shadow-glow transition-all duration-micro hover:brightness-110 active:scale-95 cursor-pointer"
      @click="startNewSession(); emit('select')"
    >
      <Plus :size="15" /> 新建会话
    </button>
    <p class="px-2 pb-1 text-xs font-medium text-ink-2">会话</p>

    <div
      v-for="s in sessions"
      :key="s.id"
      class="group flex items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-all duration-micro cursor-pointer"
      :class="s.id === activeSessionId ? 'bg-brand/15 text-brand' : 'text-ink-1 hover:bg-glass'"
      @click="pick(s.id)"
    >
      <MessageSquare :size="14" class="shrink-0" />
      <span class="min-w-0 flex-1 truncate text-sm">{{ s.title }}</span>
      <span class="shrink-0 text-[10px] text-ink-2 group-hover:hidden">{{ fmt(s.updated_at) }}</span>
      <button
        type="button"
        class="hidden h-5 w-5 shrink-0 items-center justify-center rounded-md text-ink-2 transition-all duration-micro hover:bg-bg-2 hover:text-err group-hover:flex cursor-pointer"
        aria-label="删除会话"
        @click.stop="removeSession(s.id)"
      >
        <Trash2 :size="12" />
      </button>
    </div>

    <p v-if="!sessions.length" class="px-2 py-3 text-xs text-ink-2">暂无历史会话</p>
  </div>
</template>
