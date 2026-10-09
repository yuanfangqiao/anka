<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Blocks, Sparkles } from 'lucide-vue-next'
import BaseButton from './ui/BaseButton.vue'
import { useToast } from '../composables/useToast'
import { registry } from '../registry/appRegistry'
import { ensureHomeApp, homeApp } from '../system/settings/useHomeApp'

const router = useRouter()
const { warn } = useToast()

// M17.12.1：偏好解析期间只显示 spinner，不显示「空系统」误导内容；
// 偏好已在 main.ts bootstrap 并行预取，此处通常立即解析（无等待）。
const resolving = ref(true)

// M17.12：启动跳转 —— 按首页偏好解析，回退链：
// 偏好应用（仍注册且在 dock）→ 对话 → 首个 dock 应用 → 停留本空态页。
// 未设置偏好时沿用原逻辑：装了应用插件才跳，只剩系统插件则停留空态引导。
onMounted(async () => {
  await ensureHomeApp()
  const preferredId = homeApp.value
  if (preferredId) {
    const app = registry.byId(preferredId)
    if (app?.inDock) {
      // route 可能带可选参数（/settings/:section?），剥掉参数段只留具体路径
      router.replace(app.route.replace(/\/:.*$/, ''))
      return
    }
    warn(`首页应用「${preferredId}」已不可用，已回到对话`)
  }
  if (registry.firstUserApp.value) {
    const chat = registry.apps.find((a) => a.id === 'chat')
    router.replace(chat?.route ?? registry.dockApps.value[0]?.route ?? '/chat')
    return
  }
  resolving.value = false
})
</script>

<template>
  <!-- M17.12.1：解析首页偏好期间只显示 spinner（慢网络下也不闪「空系统」误导内容） -->
  <div v-if="resolving" class="flex h-full min-h-[60dvh] items-center justify-center" aria-label="加载中">
    <div class="h-8 w-8 animate-spin rounded-full border-[3px] border-brand/25 border-t-brand"></div>
  </div>
  <div v-else class="flex h-full min-h-[60dvh] flex-col items-center justify-center gap-5 px-6 text-center">
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
    <BaseButton @click="router.push('/settings/plugins')">
      <Blocks :size="15" /> 浏览插件
    </BaseButton>
    <p class="flex items-center gap-1.5 text-[11px] text-ink-2">
      <Sparkles :size="12" class="text-brand-cyan" />
      应用插件 = 前后端一体的文件夹，装进 plugins/ 目录即可被发现
    </p>
  </div>
</template>
