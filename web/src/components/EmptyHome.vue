<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Blocks, Sparkles } from 'lucide-vue-next'
import BaseButton from './ui/BaseButton.vue'
import { registry } from '../registry/appRegistry'

const router = useRouter()

// 装了应用插件 → 跳到主应用「对话」；
// 只剩系统插件（空系统）→ 停留本空态页
onMounted(() => {
  if (registry.firstUserApp.value) {
    const chat = registry.apps.find((a) => a.id === 'chat')
    router.replace(chat?.route ?? registry.dockApps.value[0]?.route ?? '/chat')
  }
})
</script>

<template>
  <div class="flex h-full min-h-[60dvh] flex-col items-center justify-center gap-5 px-6 text-center">
    <div class="relative">
      <div class="absolute inset-0 rounded-[28px] bg-gradient-to-br from-brand to-brand-cyan opacity-40 blur-2xl"></div>
      <div class="relative flex h-20 w-20 items-center justify-center rounded-[28px] bg-gradient-to-br from-brand to-brand-cyan text-3xl font-bold text-white shadow-glow">
        A
      </div>
    </div>
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">你的 AgentOS 还是空的</h1>
      <p class="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-ink-1">
        系统现在只有内核和系统插件。去插件管理安装应用，让系统「长」出来。
      </p>
    </div>
    <BaseButton @click="router.push('/plugins-manager')">
      <Blocks :size="15" /> 浏览插件
    </BaseButton>
    <p class="flex items-center gap-1.5 text-[11px] text-ink-2">
      <Sparkles :size="12" class="text-brand-cyan" />
      应用插件 = 前后端一体的文件夹，装进 plugins/ 目录即可被发现
    </p>
  </div>
</template>
