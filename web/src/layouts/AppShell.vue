<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import TopBar from '../components/TopBar.vue'
import DockBar from '../components/DockBar.vue'
import { registry } from '../registry/appRegistry'
import { useToast } from '../composables/useToast'
import { detectStandalone } from '../system/useInstallPrompt'
import { isMobile } from '../composables/useBreakpoint'
import ApplicationWorkspace from '../runtime/ApplicationWorkspace.vue'

const route = useRoute()
const { warn } = useToast()

// 顶栏只服务「需要返回」的非 dock 系统页（如插件管理）；
// dock 应用（对话/设置等）自带页头，page 类应用全屏——一律整屏交给应用自己
const needsChrome = computed(() => {
  if (!isMobile.value || route.meta.fullscreen) return false
  const app = registry.apps.find((a) => a.id === (route.meta.appId as string | undefined))
  return Boolean(app && !app.inDock)
})

const collapsed = ref(false)

// M18：登录页不显示 dock（避免未登录时露出应用入口）
const isLogin = computed(() => route.path === '/login')

function onScroll(e: Event) {
  collapsed.value = (e.target as HTMLElement).scrollTop > 44
}

// iOS：浏览器内打开（非主屏图标启动）时，顶栏域名/底栏分享按钮是宿主浏览器的 UI，
// 页面代码无法去除；且摄像头/麦克风授权为会话级、每次使用都要重新允许。
// 每会话提示一次正确打开方式（安装后授权只问一次）
watch(isMobile, (mobile) => {
  if (!mobile || detectStandalone() || sessionStorage.getItem('pwa-standalone-hint')) return
  sessionStorage.setItem('pwa-standalone-hint', '1')
  window.setTimeout(() => {
    warn('建议添加到主屏幕——从图标启动才是全屏应用，拍照/录音也只需授权一次')
  }, 800)
}, { immediate: true })
</script>

<template>
  <!-- 两段式：上方内容区（独立内滚）+ 下方 dock 专属条——内容永不滑到 dock 背后。
       overflow-hidden + min-h-0 布局不变式：任何子元素异常都只被裁剪，
       dock 在结构上不可能被推到视口之外（安卓真机溢出加固）。
       横屏/全屏跨断点只更新样式，保持 RouterView 和游戏 iframe 的 DOM 位置不变。 -->
  <div
    class="flex h-full flex-col overflow-hidden"
    :class="{ relative: isMobile }"
    :style="isMobile ? undefined : {
      paddingTop: 'env(safe-area-inset-top, 0px)',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    }"
  >
    <TopBar v-if="needsChrome" :collapsed="collapsed" />
    <main
      class="relative min-h-0 flex-1 overflow-hidden"
      :class="{ 'pt-14': needsChrome, 'glass-panel rounded-2xl shadow-card': !isMobile }"
      @scroll.capture.passive="onScroll"
    >
      <ApplicationWorkspace />
    </main>
    <div
      v-if="!isLogin"
      class="shrink-0"
      :class="isMobile ? 'px-3 pt-2' : 'flex justify-center'"
      :style="isMobile ? { paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' } : undefined"
    >
      <DockBar :desktop="!isMobile" />
    </div>
  </div>
</template>
