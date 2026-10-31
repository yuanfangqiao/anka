import { inject, type InjectionKey } from 'vue'
import type { useDock } from './useDock'

export const DOCK_CONTEXT: InjectionKey<ReturnType<typeof useDock>> = Symbol('anka-dock')
export function useDockContext() {
  const dock = inject(DOCK_CONTEXT)
  if (!dock) throw new Error('Dock 上下文未初始化')
  return dock
}
