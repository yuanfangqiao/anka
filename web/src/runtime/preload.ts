import type { AppInfo } from '../services/api'
import { appRuntime } from './appRuntime'

const queued = new Map<string, AppInfo>()
const warmed = new Set<string>()
let scheduled = false
const inflight = new Map<string, AbortController>()
const idle = (callback: () => void) => {
  if ('requestIdleCallback' in window) window.requestIdleCallback(callback, { timeout: 3000 })
  else setTimeout(callback, 1000)
}

async function resources(app: AppInfo, signal: AbortSignal) {
  const entry = new URL(app.entry, location.href)
  if (entry.origin !== location.origin) return
  const response = await fetch(entry, { credentials: 'same-origin', signal })
  if (!response.ok) throw new Error(`预加载失败: ${response.status}`)
  if (app.kind !== 'page') {
    const link = document.createElement('link')
    link.rel = 'modulepreload'; link.href = app.entry; link.dataset.ankaPreload = app.id
    document.head.appendChild(link)
    if (app.style) await fetch(app.style, { credentials: 'same-origin', signal })
    return
  }
  // Fetch only declared scripts/styles. Parsing HTML does not execute scripts or mount a page.
  const doc = new DOMParser().parseFromString(await response.text(), 'text/html')
  const base = new URL(doc.querySelector('base')?.getAttribute('href') || entry.href, entry)
  const urls = [...doc.querySelectorAll('script[src],link[rel="stylesheet"][href]')].slice(0, 16)
    .map(node => new URL(node.getAttribute('src') || node.getAttribute('href')!, base))
    .filter(url => url.origin === location.origin)
  await Promise.allSettled(urls.map(url => fetch(url, { credentials: 'same-origin', signal })))
}

export function cancelPreloads(id: string) {
  queued.delete(id)
  inflight.get(id)?.abort()
  for (const key of warmed) if (key.startsWith(id + ':')) warmed.delete(key)
  for (const node of document.querySelectorAll<HTMLLinkElement>('link[data-anka-preload]')) {
    if (node.dataset.ankaPreload === id) node.remove()
  }
}

export function schedulePreloads(apps: AppInfo[], load: (id: string) => Promise<void>) {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  if (connection?.saveData || connection?.effectiveType === '2g') return
  const installed = new Set(apps.map(app => app.id))
  for (const id of queued.keys()) if (!installed.has(id)) queued.delete(id)
  for (const app of apps) {
    const key = app.id + ':' + app.entry
    if (app.runtime?.preload !== 'none' && !warmed.has(key)) queued.set(app.id, app)
  }
  if (scheduled || !queued.size) return
  scheduled = true
  const step = async () => {
    const entry = queued.entries().next().value
    if (!entry) { scheduled = false; return }
    const [id, app] = entry
    queued.delete(id)
    if (document.visibilityState !== 'visible') { queued.set(id, app); setTimeout(() => idle(step), 5000); return }
    const controller = new AbortController()
    inflight.set(id, controller)
    const timeout = setTimeout(() => controller.abort(), 10000)
    try {
      await resources(app, controller.signal)
      if (controller.signal.aborted) throw new Error('预热已取消')
      if (app.runtime?.preload === 'execute') {
        await appRuntime.prewarm(id)
      }
      warmed.add(app.id + ':' + app.entry)
    } catch (error) { console.debug('[app-preload]', id, error) }
    finally { clearTimeout(timeout); if (inflight.get(id) === controller) inflight.delete(id) }
    idle(step)
  }
  idle(step)
}
