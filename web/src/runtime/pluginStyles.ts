const styleLoads = new Map<string, { promise: Promise<void>; link: HTMLLinkElement }>()
/** appId → 样式 URL（卸载时据此摘掉 <link>） */
const appStyles = new Map<string, string>()

export function ensureAppStyle(href: string): Promise<void> {
  const cached = styleLoads.get(href)
  if (cached) return cached.promise
  const link = document.createElement('link')
  const load = new Promise<void>((resolve) => {
    link.rel = 'stylesheet'
    link.href = href
    link.dataset.pluginStyle = '1'
    link.onload = () => resolve()
    link.onerror = () => {
      console.warn(`插件样式加载失败: ${href}`)
      resolve()
    }
  })
  document.head.appendChild(link)
  const timed = Promise.race([
    load,
    new Promise<void>((resolve) => setTimeout(resolve, 3000)),
  ])
  styleLoads.set(href, { promise: timed, link })
  return timed
}

/** 卸载插件时摘掉它的样式表，避免重装后新旧两份 CSS 并存 */
export function removeAppStyle(href: string) {
  const rec = styleLoads.get(href)
  if (!rec) return
  rec.link.remove()
  styleLoads.delete(href)
}

