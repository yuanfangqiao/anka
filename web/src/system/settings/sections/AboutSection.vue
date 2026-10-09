<script setup lang="ts">
/** M17.11：关于（自原 SettingsView 抽取，内容不变） */
import { Info } from 'lucide-vue-next'
import BaseCard from '../../../components/ui/BaseCard.vue'
</script>

<template>
  <section class="space-y-2">
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
