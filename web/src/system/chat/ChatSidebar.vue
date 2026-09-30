<script setup lang="ts">
import { ref } from 'vue'
import { MessageSquare, Plus } from 'lucide-vue-next'
import { useToast } from '../../composables/useToast'

const toast = useToast()

interface Session {
  id: number
  title: string
  time: string
  active?: boolean
}

const sessions = ref<Session[]>([
  { id: 1, title: '当前会话', time: '现在', active: true },
  { id: 2, title: 'Agent 架构讨论', time: '昨天' },
  { id: 3, title: 'PWA 安装清单确认', time: '周一' },
])

function pick(s: Session) {
  sessions.value.forEach((x) => (x.active = x.id === s.id))
}

function create() {
  toast.ok('新会话已创建（多会话存储在 M5 落地）')
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <button
      type="button"
      class="mb-2 flex h-9 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-brand to-brand-cyan text-[13px] font-medium text-white shadow-glow transition-all duration-micro hover:brightness-110 active:scale-95 cursor-pointer"
      @click="create"
    >
      <Plus :size="15" /> 新建会话
    </button>
    <p class="px-2 pb-1 text-xs font-medium text-ink-2">会话</p>
    <button
      v-for="s in sessions"
      :key="s.id"
      type="button"
      class="flex items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-all duration-micro cursor-pointer"
      :class="s.active ? 'bg-brand/15 text-brand' : 'text-ink-1 hover:bg-glass'"
      @click="pick(s)"
    >
      <MessageSquare :size="14" class="shrink-0" />
      <span class="min-w-0 flex-1 truncate text-sm">{{ s.title }}</span>
      <span class="shrink-0 text-[10px] text-ink-2">{{ s.time }}</span>
    </button>
  </div>
</template>
