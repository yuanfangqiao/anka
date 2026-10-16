import { createWebHistory, type RouterHistory } from 'vue-router'

const BOUNDARY = '__ankaBoundary'
export const NAV_ACTION = '__ankaNavigation'

/** 两条同文档记录：底部边界 + 当前应用。插件栈由 navigation 管理。
 * 在 RouterHistory 层消费 pop，Vue Router 不会先渲染上一个插件。
 * 所有写入经 createWebHistory，保留 position/current 等路由器状态。 */
export function createAppHistory() {
  const browser = createWebHistory()
  let armed = false
  let onBack: () => void = () => {}
  const history: RouterHistory = {
    get base() { return browser.base },
    get location() { return browser.location },
    get state() { return browser.state },
    createHref: browser.createHref,
    go: browser.go,
    destroy: browser.destroy,
    push(to, data) {
      if (armed) browser.replace(to, { ...data, [BOUNDARY]: 'active', [NAV_ACTION]: 'push' })
      else browser.push(to, data)
    },
    replace(to, data) {
      browser.replace(to, {
        ...data,
        ...(armed ? { [BOUNDARY]: 'active' } : {}),
        [NAV_ACTION]: 'replace',
      })
    },
    listen(callback) {
      return browser.listen((to, from, info) => {
        if (!armed) { callback(to, from, info); return }
        // 先恢复当前 URL 与历史游标，再执行插件返回；不会走跨应用路由过渡。
        // push 截断刚退出的 forward 记录，反复返回不会无限增加历史长度。
        browser.push(from, { [BOUNDARY]: 'active' })
        if (info.delta <= 0) onBack()
      })
    },
  }

  return {
    history,
    start(handler: () => void) {
      onBack = handler
      if (armed) return
      armed = true
      // 刷新已有 active 记录时复用边界，避免每次刷新多出一条历史。
      if (browser.state[BOUNDARY] === 'active') return
      browser.replace(browser.location, { [BOUNDARY]: 'base' })
      browser.push(browser.location, { [BOUNDARY]: 'active' })
    },
  }
}
