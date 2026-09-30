import { onBeforeUnmount, onMounted, ref } from 'vue'

/** 模块级共享：uiCtx 直接注入给插件，避免 N 个插件各自建 matchMedia 监听 */
export const isMobile = ref(false)
export const isWide = ref(false)

let bound = false

function bind() {
  const mqMobile = window.matchMedia('(max-width: 768px)')
  const mqWide = window.matchMedia('(min-width: 1280px)')
  const sync = () => {
    isMobile.value = mqMobile.matches
    isWide.value = mqWide.matches
  }
  sync()
  mqMobile.addEventListener('change', sync)
  mqWide.addEventListener('change', sync)
  return () => {
    mqMobile.removeEventListener('change', sync)
    mqWide.removeEventListener('change', sync)
  }
}

let unbind: (() => void) | null = null

export function useBreakpoint() {
  onMounted(() => {
    if (!bound) {
      unbind = bind()
      bound = true
    }
  })
  onBeforeUnmount(() => {
    // 根组件常驻，不主动解绑；HMR 场景下兜底
  })
  return { isMobile, isWide }
}
