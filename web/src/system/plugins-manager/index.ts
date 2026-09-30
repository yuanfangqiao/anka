import type { UiCtx } from '../../registry/uiCtx'
import PluginsManagerView from './PluginsManagerView.vue'

/** 系统插件：插件管理（self-hosting —— 管理插件的插件） */
export function setup(uiCtx: UiCtx) {
  uiCtx.registerApp({
    id: 'plugins-manager',
    title: '插件管理',
    icon: 'blocks',
    route: '/plugins-manager',
    order: 98,
    system: true,
    inDock: false,
    component: PluginsManagerView,
  })
}
