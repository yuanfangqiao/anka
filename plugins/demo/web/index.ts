/**
 * demo 插件前端入口（TypeScript）
 * 主界面是标准 Vue SFC（./Demo.vue），vue 由内核 alias 提供同一实例，
 * 组件 / api / toast 等经 uiCtx 注入并以 props 传给 SFC。
 */
import DemoPage from './Demo.vue'
import type { UiCtx } from './types'

export function setup(uiCtx: UiCtx): void {
  const { defineComponent, h } = uiCtx.vue

  // 包一层：把 uiCtx 作为 prop 传入 SFC
  const DemoApp = defineComponent({
    name: 'DemoApp',
    setup: () => () => h(DemoPage, { uiCtx }),
  })

  uiCtx.registerApp({
    id: 'demo',
    title: '示例',
    icon: 'sparkles',
    route: '/demo',
    order: 30,
    component: DemoApp,
  })
}
