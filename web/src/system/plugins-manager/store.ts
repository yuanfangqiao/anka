import { reactive } from 'vue'

export type PmSection = 'all' | 'running' | 'available' | 'system'

/** 插件管理页的共享状态（页面与工作栏通信） */
export const pmState = reactive<{ section: PmSection }>({ section: 'all' })
