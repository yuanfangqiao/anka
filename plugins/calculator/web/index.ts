/**
 * calculator 插件前端入口（TypeScript）
 */
import CalcPage from './Calc.vue'
import type { UiCtx } from './types'

export function setup(uiCtx: UiCtx): void {
  const { defineComponent, h } = uiCtx.vue

  const CalcApp = defineComponent({
    name: 'CalcApp',
    setup: () => () => h(CalcPage, { uiCtx }),
  })

  uiCtx.registerApp({
    id: 'calculator',
    title: '计算器',
    icon: 'calculator',
    route: '/calculator',
    order: 40,
    component: CalcApp,
  })
}
