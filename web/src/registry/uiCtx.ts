/**
 * uiCtx —— 前端插件注册契约（M7：布局权下放给 App）。
 * 插件主界面整块渲染进内核主窗口，左右分栏或全屏由 App 自己决定。
 * 应用插件不 import 任何 npm 包，一切依赖由此注入。
 */
import {
  computed,
  defineComponent,
  h,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  watch,
  type ComputedRef,
} from 'vue'
import * as LucideIcons from 'lucide-vue-next'
import type { Router } from 'vue-router'
import BaseButton from '../components/ui/BaseButton.vue'
import BaseCard from '../components/ui/BaseCard.vue'
import BasePanel from '../components/ui/BasePanel.vue'
import BaseSwitch from '../components/ui/BaseSwitch.vue'
import StateBadge from '../components/ui/StateBadge.vue'
import { isMobile, isWide } from '../composables/useBreakpoint'
import { useToast } from '../composables/useToast'
import { api } from '../services/api'
import { registry, type AppMeta } from './appRegistry'

export interface UiCtx {
  vue: {
    defineComponent: typeof defineComponent
    h: typeof h
    ref: typeof ref
    reactive: typeof reactive
    computed: typeof computed
    watch: typeof watch
    onMounted: typeof onMounted
    onUnmounted: typeof onUnmounted
  }
  components: {
    BaseCard: typeof BaseCard
    BaseButton: typeof BaseButton
    BaseSwitch: typeof BaseSwitch
    StateBadge: typeof StateBadge
    BasePanel: typeof BasePanel
  }
  icons: typeof LucideIcons
  api: typeof api
  toast: ReturnType<typeof useToast>
  /** 形态判断（内核共享同一份 matchMedia 监听） */
  layout: { isMobile: ComputedRef<boolean>; isWide: ComputedRef<boolean> }
  registerApp: (meta: AppMeta) => void
  unregisterApp: (appId: string) => void
}

export function createUiCtx(router: Router): UiCtx {
  const toast = useToast()

  return {
    vue: { defineComponent, h, ref, reactive, computed, watch, onMounted, onUnmounted },
    components: { BaseCard, BaseButton, BaseSwitch, StateBadge, BasePanel },
    icons: LucideIcons,
    api,
    toast,
    layout: { isMobile, isWide },

    registerApp(meta: AppMeta) {
      // 默认进 dock、非系统插件；显式声明 inDock:false/system:true 才覆盖
      registry.addApp({ inDock: true, system: false, ...meta })
      const name = `app:${meta.id}`
      if (router.hasRoute(name)) router.removeRoute(name)
      router.addRoute({
        path: meta.route,
        name,
        component: meta.component,
        meta: { title: meta.title, appId: meta.id },
      })
    },

    unregisterApp(appId) {
      registry.removeApp(appId)
      const name = `app:${appId}`
      if (router.hasRoute(name)) router.removeRoute(name)
    },
  }
}
