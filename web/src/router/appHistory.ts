import { createWebHistory, type RouterHistory } from 'vue-router'

const BOUNDARY = '__ankaBoundary'
export const NAV_ACTION = '__ankaNavigation'

/** 宿主保留边界/当前两条记录，插件内部栈由 navigation 管理。
 * 返回时 go(1) 复用已有记录，禁止在 popstate 后 push：Chromium 会将
 * 无新用户激活时插入的记录标为可跳过，下一次 Android Back 会越过宿主。 */
export function createAppHistory() {
  const browser = createWebHistory()
  let armed = false
  let onBack: () => void = () => {}
  let phase: 'idle' | 'align' | 'restore' = 'idle'
  let target = browser.location
  let targetState = browser.state
  let dispatchBack = false
  let alignAgain = false

  function write(to: string, data: Parameters<RouterHistory['replace']>[1], action: string) {
    const state = { ...data, ...(armed ? { [BOUNDARY]: 'active' } : {}), [NAV_ACTION]: action }
    target = to
    if (phase !== 'idle') { targetState = { ...targetState, ...state, current: to }; return }
    browser.replace(to, state)
    targetState = browser.state
  }

  const history: RouterHistory = {
    get base() { return browser.base },
    get location() { return phase === 'idle' ? browser.location : target },
    get state() { return phase === 'idle' ? browser.state : targetState },
    createHref: browser.createHref,
    go: browser.go,
    destroy: browser.destroy,
    push(to, data) {
      if (armed) write(to, data, 'push')
      else browser.push(to, data)
    },
    replace(to, data) { write(to, data, 'replace') },
    listen(callback) {
      return browser.listen((to, from, info) => {
        if (!armed) { callback(to, from, info); return }
        if (phase === 'restore') {
          phase = 'idle'
          browser.replace(target, { ...targetState, back: target, [BOUNDARY]: 'active' })
          targetState = browser.state
          const shouldBack = dispatchBack
          dispatchBack = false
          if (alignAgain) { alignAgain = false; alignBoundary() }
          if (shouldBack) onBack()
          return
        }
        if (info.delta === 0) { browser.replace(target, targetState); return }
        if (phase === 'idle') {
          target = from
          // 本次原生返回由当前插件消费；边界也改成当前应用，清除旧插件 URL。
          dispatchBack = info.delta < 0
        }
        browser.replace(target, { forward: target, [BOUNDARY]: 'base' })
        phase = 'restore'
        // 不产生新历史，不重置 Chromium 的用户激活标记。
        browser.go(-info.delta)
      })
    },
  }

  /** 快速连切时补一次对齐，避免恢复途中最后一次切换留下旧边界。 */
  function alignBoundary() {
    if (!armed) return
    if (phase !== 'idle') { alignAgain = true; return }
    target = browser.location
    targetState = browser.state
    phase = 'align'
    browser.go(-1)
  }

  return {
    history,
    alignBoundary,
    start(handler: () => void) {
      onBack = handler
      if (armed) return
      armed = true
      target = browser.location
      if (browser.state[BOUNDARY] !== 'active') {
        browser.replace(target, { [BOUNDARY]: 'base' })
        browser.push(target, { [BOUNDARY]: 'active' })
      }
      targetState = browser.state
    },
  }
}
