import { nextTick } from 'vue'
import { registry } from '../../registry/appRegistry'
import { useAppNavigation } from '../../services/navigation'
import { appRuntime } from '../appRuntime'

const PRIVATE = '[data-web-use-private],input[type=password],input[type=file],[autocomplete="one-time-code"],[autocomplete^="cc-"],[inert],[aria-hidden=true]'
const CONTROL = 'button,a[href],input:not([type=hidden]),textarea,select,[contenteditable=true],[role=button],[role=link],[role=checkbox],[role=slider],[role=textbox],canvas,[data-web-use-target]'
const TEXT_INPUT = new Set(['text', 'search', 'email', 'url', 'tel', 'number'])
export const settle = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) return reject(signal.reason)
  const frame = requestAnimationFrame(() => {
    signal.removeEventListener('abort', abort)
    resolve()
  })
  function abort() { cancelAnimationFrame(frame); reject(signal.reason) }
  signal.addEventListener('abort', abort, { once: true })
})

export function requireForeground(signal: AbortSignal) {
  signal.throwIfAborted()
  if (document.visibilityState !== 'visible') throw Error('Anka 窗口不在前台')
}

export function apps() {
  return registry.apps.filter(app => !app.system).slice(0, 100).map(({ id, title }) => ({
    appId: id, title: title.slice(0, 120),
  }))
}

export function surface(appId = appRuntime.state.activeId) {
  const app = registry.byId(appId)
  const run = appRuntime.runs.get(appId)
  if (!app || app.system || !run?.visible || !run.focused) throw Error('请先打开要操作的插件')
  if (run.status === 'error') throw Error('插件加载失败')
  const host = Array.from(document.querySelectorAll<HTMLElement>('[data-app-instance]'))
    .find(el => el.dataset.appInstance === appId)
  if (!host || run.status !== 'ready') throw Error('插件尚未就绪')
  if (host.closest(PRIVATE)) throw Error('这个插件区域已排除网页操作')
  const frame = Array.from(host.querySelectorAll<HTMLIFrameElement>('iframe[data-web-use-frame]'))
    .find(el => el.dataset.webUseFrame === appId)
  if (frame) {
    if (frame.closest(PRIVATE)) throw Error('这个 iframe 已排除网页操作')
    const doc = frame.contentDocument
    if (!doc) throw Error('此 iframe 无法由 Anka 网页操作')
    if (doc.URL === 'about:blank' || doc.readyState === 'loading' || !doc.body) throw Error('插件尚未就绪')
    const url = new URL(doc.URL)
    if (url.origin !== location.origin || !url.pathname.startsWith('/plugins/' + appId + '/')) {
      throw Error('此 iframe 已离开该插件页面')
    }
    return { appId, key: run.key, route: run.route.fullPath, host, frame, doc, root: doc.body }
  }
  return { appId, key: run.key, route: run.route.fullPath, host, frame: undefined, doc: document, root: host }
}

export type Surface = ReturnType<typeof surface>

export async function open(appId: string, signal: AbortSignal) {
  requireForeground(signal)
  const app = registry.byId(appId)
  if (!app || app.system) throw Error('只能打开已安装的 Anka 插件')
  await useAppNavigation().switchApp(appId)
  const end = performance.now() + 20_000
  while (performance.now() < end) {
    requireForeground(signal)
    await nextTick()
    await settle(signal)
    try {
      const view = surface(appId)
      return { appId, title: app.title, route: view.route, ready: true }
    } catch (error) {
      if (!(error instanceof Error) || error.message !== '插件尚未就绪') {
        // The first route update can precede the application runtime's focus update.
        if (appRuntime.runs.get(appId)?.status === 'error' ||
            (error instanceof Error && error.message.includes('iframe'))) throw error
      }
    }
  }
  throw Error('等待插件显示超时')
}

export function allowed(view: Surface, el: Element) {
  if (!el.isConnected || !view.root.contains(el) || el.closest(PRIVATE)) return false
  return Boolean(view.frame) || el.closest('[data-app-instance]') === view.host
}

export function rectOf(el: Element) {
  const { left, top, width, height } = el.getBoundingClientRect()
  return { left, top, width, height }
}

export function visible(view: Surface, el: Element) {
  if (!allowed(view, el)) return false
  const r = el.getBoundingClientRect()
  const style = view.doc.defaultView!.getComputedStyle(el)
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 &&
    r.left < view.doc.documentElement.clientWidth && r.top < view.doc.documentElement.clientHeight &&
    style.visibility === 'visible' && style.display !== 'none' && style.opacity !== '0'
}

function label(el: Element) {
  const input = el as HTMLInputElement
  return (el.getAttribute('aria-label') || input.labels?.[0]?.textContent ||
    el.getAttribute('title') || el.getAttribute('placeholder') || el.textContent || '')
    .replace(/\s+/g, ' ').trim().slice(0, 100)
}

export function scrollable(el: Element) {
  const style = el.ownerDocument.defaultView!.getComputedStyle(el)
  return (el.scrollHeight > el.clientHeight + 2 && /auto|scroll/.test(style.overflowY)) ||
    (el.scrollWidth > el.clientWidth + 2 && /auto|scroll/.test(style.overflowX))
}

export function scan(view: Surface) {
  const elements = new Map<string, Element>()
  const descriptions: Array<{ id: string; role: string; label: string; editable?: boolean; scrollable?: boolean }> = []
  const controls = view.root.querySelectorAll(CONTROL)
  for (let i = 0; i < Math.min(controls.length, 1500) && descriptions.length < 65; i++) {
    const el = controls[i]
    if (!visible(view, el) || el.matches(':disabled,[aria-disabled=true]')) continue
    const id = 'e' + (i + 1)
    elements.set(id, el)
    descriptions.push({ id, role: el.getAttribute('role') || el.tagName.toLowerCase(),
      label: label(el), editable: writable(el) || undefined })
  }
  const walk = view.doc.createTreeWalker(view.root, NodeFilter.SHOW_ELEMENT)
  let el: Node | null = view.root
  for (let i = 0; el && i < 1800 && descriptions.length < 76; i++, el = walk.nextNode()) {
    const element = el as Element
    if (!visible(view, element) || !scrollable(element)) continue
    const id = 's' + i
    elements.set(id, element)
    descriptions.push({ id, role: 'scroll', label: element.getAttribute('aria-label')?.slice(0, 100) || '', scrollable: true })
  }
  return { elements, descriptions }
}

export function visibleText(view: Surface) {
  const walker = view.doc.createTreeWalker(view.root, NodeFilter.SHOW_TEXT)
  const lines: string[] = []
  let length = 0
  for (let i = 0, node = walker.nextNode(); node && i < 1200 && length < 2200; node = walker.nextNode(), i++) {
    const value = node.textContent?.replace(/\s+/g, ' ').trim()
    const el = node.parentElement
    if (!value || !el || el.closest('script,style,textarea,[contenteditable=true]') || !visible(view, el)) continue
    const range = view.doc.createRange()
    range.selectNodeContents(node)
    const rect = range.getBoundingClientRect()
    if (!rect.width || !rect.height || !hit(view, (rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2)) continue
    const chunk = value.slice(0, 150)
    lines.push(chunk)
    length += chunk.length + 1
  }
  return lines.join('\n').slice(0, 2200)
}

export function writable(el: Element) {
  if (el.matches(':disabled,[readonly],[aria-disabled=true],[aria-readonly=true]')) return false
  return el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && TEXT_INPUT.has((el as HTMLInputElement).type)) ||
    el.getAttribute('contenteditable') === 'true'
}

function topPoint(view: Surface, x: number, y: number) {
  const frame = view.frame
  if (!frame) return { x, y }
  const r = frame.getBoundingClientRect()
  const sx = r.width / frame.offsetWidth
  const sy = r.height / frame.offsetHeight
  return { x: r.left + (frame.clientLeft + x) * sx, y: r.top + (frame.clientTop + y) * sy }
}

export function hit(view: Surface, x: number, y: number) {
  const point = topPoint(view, x, y)
  if (view.frame && document.elementFromPoint(point.x, point.y) !== view.frame) return null
  const el = view.doc.elementFromPoint(x, y)
  return el && allowed(view, el) ? el : null
}

export function reachablePoint(view: Surface, el: Element) {
  const r = el.getBoundingClientRect()
  const vw = el.ownerDocument.documentElement.clientWidth
  const vh = el.ownerDocument.documentElement.clientHeight
  const left = Math.max(0, r.left), right = Math.min(vw, r.right)
  const top = Math.max(0, r.top), bottom = Math.min(vh, r.bottom)
  if (right <= left || bottom <= top) return null
  const x = (left + right) / 2, y = (top + bottom) / 2
  const ex = Math.min(4, (right - left) / 4), ey = Math.min(4, (bottom - top) / 4)
  // A floating status pill or a clipped container can cover the center but
  // leave part of the real control reachable. Never dispatch through a cover.
  return [
    { x, y }, { x: left + ex, y }, { x: right - ex, y },
    { x, y: top + ey }, { x, y: bottom - ey },
    { x: left + ex, y: top + ey }, { x: right - ex, y: top + ey },
    { x: left + ex, y: bottom - ey }, { x: right - ex, y: bottom - ey },
  ].find(point => {
    const actual = hit(view, point.x, point.y)
    return actual && (actual === el || el.contains(actual))
  }) ?? null
}

export function feedback(view: Surface, x: number, y: number) {
  const point = topPoint(view, x, y)
  const circle = document.createElement('div')
  circle.setAttribute('aria-hidden', 'true')
  Object.assign(circle.style, { position: 'fixed', pointerEvents: 'none', zIndex: '2147483647',
    left: point.x + 'px', top: point.y + 'px', width: '30px', height: '30px',
    border: '2px solid #36d4f4', borderRadius: '50%', background: '#36d4f433' })
  document.body.append(circle)
  if (typeof circle.animate === 'function') {
    circle.animate([{ transform: 'translate(-50%, -50%) scale(.65)' },
      { transform: 'translate(-50%, -50%) scale(1.55)', opacity: 0 }], 380)
  } else circle.style.transform = 'translate(-50%, -50%)'
  setTimeout(() => circle.remove(), 380)
}

export function click(view: Surface, target: Element, x: number, y: number) {
  const anchor = target.closest('a[href]') as HTMLAnchorElement | null
  if (anchor && (anchor.target && anchor.target !== '_self' || anchor.hasAttribute('download') ||
      !['http:', 'https:'].includes(anchor.protocol) || anchor.origin !== location.origin)) {
    throw Error('网页操作不会打开外部地址、下载或新窗口')
  }
  if (target.matches(':disabled,[aria-disabled=true]')) throw Error('目标不可用')
  feedback(view, x, y)
  if (target.tagName === 'CANVAS' || typeof (target as HTMLElement).click !== 'function') {
    const win = view.doc.defaultView as Window & typeof globalThis
    const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y }
    target.dispatchEvent(new win.PointerEvent('pointerdown', { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 1 }))
    target.dispatchEvent(new win.PointerEvent('pointerup', { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true }))
    target.dispatchEvent(new win.MouseEvent('click', init))
  } else (target as HTMLElement).click()
}

export function fill(view: Surface, el: Element, value: string) {
  if (!writable(el)) throw Error('目标不是可填写的文字输入框')
  const win = view.doc.defaultView as Window & typeof globalThis
  const target = el as HTMLElement
  target.focus({ preventScroll: true })
  if (!allowed(view, target)) throw Error('输入框在聚焦时已经变化')
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    const proto = el.tagName === 'INPUT' ? win.HTMLInputElement.prototype : win.HTMLTextAreaElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    if ((el as HTMLInputElement).value !== value) throw Error('输入框拒绝了指定的值')
  } else target.textContent = value
  el.dispatchEvent(new win.InputEvent('input', { bubbles: true, composed: true,
    inputType: 'insertReplacementText', data: value }))
  el.dispatchEvent(new win.Event('change', { bubbles: true }))
}
