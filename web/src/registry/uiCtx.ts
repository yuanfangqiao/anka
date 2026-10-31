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
  type Ref,
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
import { useAppNavigation, type AppNavigation } from '../services/navigation'
import AppEmbed from '../runtime/AppEmbed.vue'
import WebViewPage from '../components/WebViewPage.vue'
import AppPortal from '../runtime/AppPortal.vue'
import { appRuntime } from '../runtime/appRuntime'
import { createAppServices } from '../runtime/appServices'

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
    AppEmbed: typeof AppEmbed
    WebViewPage: typeof WebViewPage
    AppPortal: typeof AppPortal
  }
  icons: typeof LucideIcons
  api: typeof api
  toast: ReturnType<typeof useToast>
  /** 形态判断（内核共享同一份 matchMedia 监听） */
  layout: { isMobile: Ref<boolean>; isWide: Ref<boolean> }
  navigation: AppNavigation
  registerApp: (meta: Omit<AppMeta, 'system' | 'inDock'> & Partial<Pick<AppMeta, 'system' | 'inDock'>>) => void
  unregisterApp: (appId: string) => void
  forApp: (appId: string, active?: () => boolean) => UiCtx & ReturnType<typeof createAppServices>
}

export function createUiCtx(router: Router): UiCtx {
  const toast = useToast()

  const ctx: UiCtx = {
    vue: { defineComponent, h, ref, reactive, computed, watch, onMounted, onUnmounted },
    components: { BaseCard, BaseButton, BaseSwitch, StateBadge, BasePanel, AppEmbed, WebViewPage, AppPortal },
    icons: LucideIcons,
    api,
    toast,
    layout: { isMobile, isWide },
    navigation: useAppNavigation(),
    forApp(appId, active = () => true) {
      const services = createAppServices(appId, active)
      return { ...ctx, ...services,
        registerApp(meta) {
          if (!active()) return
          if (meta.id !== appId) throw new Error('插件只能注册自己的应用 ID')
          ctx.registerApp(meta)
        },
        unregisterApp(id) { if (id === appId && active()) ctx.unregisterApp(id) },
        navigation: { ...ctx.navigation,
          back: () => ctx.navigation.back(appId),
          async push(to) { await appRuntime.route(appId, router.resolve(to).fullPath) },
          async replace(to) { await appRuntime.route(appId, router.resolve(to).fullPath, true) },
          async setHash(id, hash) {
            if (id !== appId) throw new Error('不能修改其他应用的地址')
            const route = appRuntime.runs.get(appId)?.route
            if (route) await appRuntime.route(appId, { path: route.path, query: route.query, hash }, true)
            else await ctx.navigation.setHash(id, hash)
          },
          register(handler) {
            if (!active()) return () => {}
            if (handler.appId !== appId) throw new Error('不能注册其他应用的返回处理器')
            return ctx.navigation.register(handler)
          },
        },
      }
    },

    registerApp(meta) {
      // 默认进 dock、非系统插件；显式声明 inDock:false/system:true 才覆盖
      registry.addApp({ inDock: true, system: false, ...meta })
      const name = `app:${meta.id}`
      if (router.hasRoute(name)) router.removeRoute(name)
      router.addRoute({
        path: meta.route,
        name,
        component: meta.component,
        meta: { title: meta.title, appId: meta.id, fullscreen: Boolean(meta.fullscreen) },
      })
    },

    unregisterApp(appId) {
      if (router.currentRoute.value.meta.appId === appId) {
        void router.replace(appId !== 'chat' && registry.byId('chat') ? '/chat' : '/?desktop=1')
      }
      appRuntime.remove(appId)
      useAppNavigation().removeApp(appId)
      registry.removeApp(appId)
      const name = `app:${appId}`
      if (router.hasRoute(name)) router.removeRoute(name)
    },
  }
  return ctx
}
