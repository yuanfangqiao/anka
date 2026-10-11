<script setup lang="ts">
/** M17.11：关于（自原 SettingsView 抽取，内容不变）；M18：新增账号卡与登出 */
import { Info, LogOut, UserRound } from 'lucide-vue-next'
import BaseCard from '../../../components/ui/BaseCard.vue'
import { authUser, logoutAndRedirect } from '../../../composables/useAuth'
</script>

<template>
  <section class="space-y-2">
    <!-- M18：账号与登出 -->
    <BaseCard class="flex items-center gap-3 !p-4">
      <span class="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand/15 text-brand">
        <UserRound :size="18" />
      </span>
      <div class="flex-1">
        <p class="text-sm font-medium">{{ authUser ?? '未登录' }}</p>
        <p class="mt-0.5 text-[11px] text-ink-2">当前登录账号 · 会话 30 天有效</p>
      </div>
      <button
        type="button"
        class="flex h-8 cursor-pointer items-center gap-1.5 rounded-xl border border-line bg-glass px-3 text-xs text-ink-1 transition-all duration-micro hover:border-err/40 hover:text-err active:scale-95"
        @click="logoutAndRedirect"
      >
        <LogOut :size="13" /> 登出
      </button>
    </BaseCard>

    <BaseCard class="!p-4">
      <div class="flex items-center gap-3">
        <span class="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-brand-cyan font-bold text-white shadow-glow">A</span>
        <div>
          <p class="text-sm font-semibold">Anka</p>
          <p class="mt-0.5 text-[11px] text-ink-2">v0.1.0 · M1 双布局壳 + PWA</p>
        </div>
      </div>
      <p class="mt-3 flex items-start gap-2 text-[12px] leading-relaxed text-ink-1">
        <Info :size="13" class="mt-0.5 shrink-0 text-brand" />
        一切皆插件的 Agent 演示：后端 cordis 内核（Service 仓库 / inject 拓扑 / 五种事件分发 / 可逆副作用），前端应用注册表驱动的双布局壳。
      </p>
    </BaseCard>
  </section>
</template>
