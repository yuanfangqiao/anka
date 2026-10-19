/**
 * trendshift 插件前端入口（无后端：iframe 内嵌）
 */
import TrendShiftPage from './TrendShift.vue'
import type { UiCtx } from './types'

export function setup(uiCtx: UiCtx): void {
  const { defineComponent, h } = uiCtx.vue

  const TrendShiftApp = defineComponent({
    name: 'TrendShiftApp',
    setup: () => () => h(TrendShiftPage),
  })

  uiCtx.registerApp({
    id: 'trendshift',
    title: '趋势榜',
    icon: 'flame',
    route: '/trendshift',
    order: 60,
    component: TrendShiftApp,
  })
}
