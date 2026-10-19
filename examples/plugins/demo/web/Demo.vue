<script setup lang="ts">
/**
 * demo 插件主界面（Vue SFC + TypeScript）
 * 通过 props 接收内核注入的 uiCtx；vue 本体经内核 alias 共享同一实例。
 */
import { onMounted, reactive } from 'vue'
import type { UiCtx } from './types'

const props = defineProps<{ uiCtx: UiCtx }>()

interface DemoSection {
  emoji: string
  title: string
  text: string
}
interface DemoState {
  title: string
  subtitle: string
  sections: DemoSection[]
}

const state = reactive<{ data: DemoState | null; loaded: boolean }>({
  data: null,
  loaded: false,
})

onMounted(async () => {
  state.data = await props.uiCtx.api.getAppState<DemoState>('demo')
  state.loaded = true
})

// 内核基础组件（经 uiCtx 注入，模板里用 <component :is> 渲染）
const BaseCard = props.uiCtx.components.BaseCard
</script>

<template>
  <div class="flex h-full p-3">
    <div class="min-w-0 flex-1 overflow-y-auto">
      <div class="mx-auto flex w-full max-w-2xl flex-col gap-4 px-1 pb-4">
        <template v-if="state.loaded && state.data">
          <header class="pt-1">
            <h1 class="text-[30px] font-bold tracking-tight">{{ state.data.title }}</h1>
            <p class="mt-1 text-sm text-ink-2">{{ state.data.subtitle }}</p>
          </header>

          <div class="stagger space-y-3">
            <component
              :is="BaseCard"
              v-for="s in state.data.sections"
              :key="s.title"
              class="!p-5"
            >
              <div class="flex items-start gap-3">
                <div class="text-2xl leading-none">{{ s.emoji }}</div>
                <div>
                  <h3 class="text-[15px] font-semibold">{{ s.title }}</h3>
                  <p class="mt-1 text-sm leading-relaxed text-ink-1">{{ s.text }}</p>
                </div>
              </div>
            </component>
          </div>
        </template>

        <component :is="BaseCard" v-else class="!p-6 text-center text-sm text-ink-2">
          加载中…
        </component>
      </div>
    </div>
  </div>
</template>
