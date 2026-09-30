import type { UiCtx } from '../../registry/uiCtx'
import SettingsView from './SettingsView.vue'

/** 系统插件：设置（像手机设置 App 一样常驻 dock 首位） */
export function setup(uiCtx: UiCtx) {
  uiCtx.registerApp({
    id: 'settings',
    title: '设置',
    icon: 'settings',
    route: '/settings',
    order: -10,
    system: true,
    inDock: true,
    component: SettingsView,
  })
}
