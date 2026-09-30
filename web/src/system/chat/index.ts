import type { UiCtx } from '../../registry/uiCtx'
import ChatView from './ChatView.vue'

/** 系统插件：对话（dogfooding —— 与应用插件走同一个 uiCtx） */
export function setup(uiCtx: UiCtx) {
  uiCtx.registerApp({
    id: 'chat',
    title: '对话',
    icon: 'message-square',
    route: '/chat',
    order: 0,
    system: true,
    inDock: true,
    component: ChatView,
  })
}
