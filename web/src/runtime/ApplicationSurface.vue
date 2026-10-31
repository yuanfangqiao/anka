<script setup lang="ts">
import { computed, onErrorCaptured, provide, shallowReactive } from 'vue'
import { routeLocationKey, routerViewLocationKey, routerKey, useRouter } from 'vue-router'
import { registry } from '../registry/appRegistry'
import { appRuntime } from './appRuntime'
import { APP_RUNTIME_KEY, type AppRun } from './contracts'
import { useAppNavigation } from '../services/navigation'

const props = defineProps<{ run: AppRun }>()
const router = useRouter()
const route = computed(() => props.run.route)
const localRoute: Record<string, unknown> = {}
for (const key of Object.keys(props.run.route)) {
  Object.defineProperty(localRoute, key, { enumerable: true, get: () => route.value[key as keyof typeof route.value] })
}
provide(routeLocationKey, shallowReactive(localRoute) as any)
provide(routerViewLocationKey, route)
// Background components use their own route even when useRouter().currentRoute is read.
const localRouter = Object.create(router)
localRouter.currentRoute = route
localRouter.push = (to: any) => appRuntime.route(props.run.id, router.resolve(to).fullPath)
localRouter.replace = (to: any) => appRuntime.route(props.run.id, router.resolve(to).fullPath, true)
localRouter.back = () => useAppNavigation().back(props.run.id)
localRouter.go = (delta: number) => {
  if (delta === -1) return localRouter.back()
  throw new Error('应用导航请使用 push/replace/back')
}
localRouter.forward = () => { throw new Error('应用导航未提供 forward') }
provide(routerKey, localRouter)
provide(APP_RUNTIME_KEY, props.run.id)
const component = computed(() => registry.byId(props.run.id)?.component)
onErrorCaptured(error => { appRuntime.fail(props.run.id, error); return false })
</script>

<template>
  <div class="h-full min-h-0 w-full" :data-app-instance="run.id" @pointerdown.capture="appRuntime.focus(run.id)">
    <div v-if="run.status === 'loading'" class="flex h-full items-center justify-center gap-3 text-sm text-ink-2" role="status">
      <span class="h-5 w-5 animate-spin rounded-full border-2 border-brand border-t-transparent"></span> 正在打开应用
    </div>
    <div v-else-if="run.status === 'error'" class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center" role="alert">
      <p class="font-medium">{{ registry.byId(run.id)?.title }} 暂时无法运行</p>
      <p class="max-w-lg break-all text-xs text-ink-2">{{ run.error }}</p>
      <button class="rounded-xl bg-brand px-4 py-2 text-sm text-white" @click="appRuntime.restart(run.id)">重新启动</button>
    </div>
    <component :is="component" v-else :key="run.key" />
  </div>
</template>
