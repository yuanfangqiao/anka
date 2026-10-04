<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import TopBar from '../components/TopBar.vue'
import DockBar from '../components/DockBar.vue'
import { registry } from '../registry/appRegistry'
import { useToast } from '../composables/useToast'

const route = useRoute()
const { warn } = useToast()

// 顶栏只服务「需要返回」的非 dock 系统页（如插件管理）；
// dock 应用（对话/设置等）自带页头，page 类应用全屏——一律整屏交给应用自己
const needsChrome = computed(() => {
  if (route.meta.fullscreen) return false
  const app = registry.apps.find((a) => a.id === (route.meta.appId as string | undefined))
  return Boolean(app && !app.inDock)
})

const collapsed = ref(false)

function onScroll(e: Event) {
  collapsed.value = (e.target as HTMLElement).scrollTop > 44
}

// iOS：浏览器内打开（非主屏图标启动）时，顶栏域名/底栏分享按钮是宿主浏览器的 UI，
// 页面代码无法去除——提示一次正确打开方式
onMounted(() => {
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  if (standalone || sessionStorage.getItem('pwa-standalone-hint')) return
  sessionStorage.setItem('pwa-standalone-hint', '1')
  window.setTimeout(() => warn('当前在浏览器内打开——从主屏幕图标进入才是全屏应用'), 800)
})
</script>

<template>
  <!-- 两段式：上方内容区（独立内滚）+ 下方 dock 专属条——内容永不滑到 dock 背后。
       overflow-hidden + min-h-0 布局不变式：任何子元素异常都只被裁剪，
       dock 在结构上不可能被推到视口之外（安卓真机溢出加固） -->
  <div class="relative flex h-dvh flex-col overflow-hidden">
    <TopBar v-if="needsChrome" :collapsed="collapsed" />
    <main
      class="relative min-h-0 flex-1 overflow-y-auto"
      :class="needsChrome ? 'pt-14' : ''"
      @scroll.passive="onScroll"
    >
      <RouterView v-slot="{ Component }">
        <Transition name="page">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>
    <div
      class="shrink-0 px-3 pt-2"
      :style="{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }"
    >
      <DockBar />
    </div>
  </div>
</template>
