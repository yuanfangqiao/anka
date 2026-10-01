/**
 * baidu 插件前端入口（后端代理纯净首页 + iframe 简洁/完整模式）
 */
import BaiduPage from './Baidu.vue'
import type { UiCtx } from './types'

export function setup(uiCtx: UiCtx): void {
  const { defineComponent, h } = uiCtx.vue

  const BaiduApp = defineComponent({
    name: 'BaiduApp',
    setup: () => () => h(BaiduPage, { uiCtx }),
  })

  uiCtx.registerApp({
    id: 'baidu',
    title: '百度',
    icon: 'search',
    route: '/baidu',
    order: 50,
    component: BaiduApp,
  })
}
