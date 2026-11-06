import { nextTick } from 'vue'
import { apps, open, surface, scan, allowed, visible, visibleText, scrollable, rectOf,
  hit, reachablePoint, feedback, click, fill, requireForeground, settle, type Surface } from './dom'
import { canvasRect, capture, type Picture } from './capture'

type Args = Record<string, unknown>
type Observation = {
  id: string; view: Surface; elements: Map<string, Element>; expires: number
  targets: Map<string, ReturnType<typeof rectOf>>
  picture?: Omit<Picture, 'blob'>; invalid: () => boolean; dispose: () => void
}
const near = (a: number, b: number) => Math.abs(a - b) < 2
const sameRect = (a: ReturnType<typeof rectOf>, b: ReturnType<typeof rectOf>) =>
  near(a.left, b.left) && near(a.top, b.top) && near(a.width, b.width) && near(a.height, b.height)

function track(view: Surface) {
  let invalidated = false
  const invalidate = () => { invalidated = true }
  const userInput = (event: Event) => { if (event.isTrusted) invalidate() }
  const mutations = new MutationObserver(invalidate)
  mutations.observe(view.root, { subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['data-web-use-revision', 'hidden', 'aria-hidden'] })
  const windows = new Set([window, view.doc.defaultView!])
  for (const win of windows) {
    win.addEventListener('scroll', invalidate, true)
    win.addEventListener('resize', invalidate)
    win.addEventListener('pointerdown', userInput, true)
    win.addEventListener('keydown', userInput, true)
    win.addEventListener('input', userInput, true)
  }
  view.frame?.addEventListener('load', invalidate)
  return {
    invalid: () => invalidated || mutations.takeRecords().length !== 0,
    dispose() {
      mutations.disconnect()
      for (const win of windows) {
        win.removeEventListener('scroll', invalidate, true)
        win.removeEventListener('resize', invalidate)
        win.removeEventListener('pointerdown', userInput, true)
        win.removeEventListener('keydown', userInput, true)
        win.removeEventListener('input', userInput, true)
      }
      view.frame?.removeEventListener('load', invalidate)
    },
  }
}

export function makeExecutor() {
  let observation: Observation | undefined
  let sequence = 0
  function clear() {
    observation?.dispose()
    observation = undefined
  }

  function current(view: Surface, id?: unknown) {
    const o = observation
    if (!o || (id !== undefined && id !== o.id) || o.invalid() || o.expires < performance.now() ||
        o.view.key !== view.key || o.view.doc !== view.doc || o.view.route !== view.route ||
        o.view.appId !== view.appId || o.view.root !== view.root) {
      clear()
      throw Error('观察已过期，请重新观察当前应用')
    }
    return o
  }

  async function execute(command: string, args: Args, signal: AbortSignal,
                         upload: (blob: Blob) => Promise<void>) {
    requireForeground(signal)
    if (command === 'list_apps') return { apps: apps() }
    if (command === 'open_app') { clear(); return open(String(args.appId), signal) }
    const view = surface()
    if (command === 'observe') {
      let canvasTarget: Element | undefined
      if (args.image === true && args.scope === 'canvas' && typeof args.target === 'string') {
        canvasTarget = current(view).elements.get(args.target)
        if (!canvasTarget) throw Error('画布 ID 已失效，请重新观察')
      }
      clear()
      const { elements, descriptions } = scan(view)
      const targets = new Map([...elements].map(([id, el]) => [id, rectOf(el)]))
      const o: Observation = { id: 'observation-' + ++sequence, view, elements, targets,
        expires: performance.now() + 90_000, ...track(view) }
      observation = o
      const result = { appId: view.appId, route: view.route, observationId: o.id,
        text: visibleText(view), elements: descriptions, image: undefined as unknown,
        imageError: undefined as string | undefined }
      if (args.image === true) {
        try {
          const { blob, ...picture } = await capture(view, args.scope, canvasTarget)
          requireForeground(signal)
          current(surface(), o.id)
          await upload(blob)
          current(surface(), o.id)
          o.picture = picture
          result.image = { width: picture.width, height: picture.height, source: picture.scope,
            coordinateTap: picture.scope === 'canvas' }
        } catch (error) {
          signal.throwIfAborted()
          result.imageError = error instanceof Error ? error.message.slice(0, 220) : '截图失败'
        }
      }
      return result
    }

    const o = current(view, args.observationId)
    const id = typeof args.target === 'string' ? args.target : ''
    const target = id ? o.elements.get(id) : undefined
    if (id && (!target || !visible(view, target) || !sameRect(rectOf(target), o.targets.get(id)!))) {
      clear()
      throw Error('目标已移动或不可见，请重新观察')
    }
    clear() // Every side effect consumes its observation, including missed clicks.
    if (command === 'scroll') {
      let scroller: Element | undefined = target
      while (scroller && allowed(view, scroller) && !scrollable(scroller)) scroller = scroller.parentElement ?? undefined
      if (!scroller || !allowed(view, scroller)) {
        const wrapper = view.host.closest('[data-app-window]')
        scroller = [...o.elements.values()].find(el => scrollable(el)) ||
          (view.frame ? view.doc.scrollingElement : wrapper && scrollable(wrapper) ? wrapper : null) || undefined
      }
      if (!scroller) throw Error('未找到可滚动容器')
      const before = { left: scroller.scrollLeft, top: scroller.scrollTop }
      scroller.scrollBy({ left: Number(args.dx ?? 0), top: Number(args.dy ?? 0), behavior: 'smooth' })
      const started = performance.now()
      let stable = started
      let last = before
      do {
        await settle(signal)
        const point = { left: scroller.scrollLeft, top: scroller.scrollTop }
        if (point.left !== last.left || point.top !== last.top) stable = performance.now()
        last = point
      } while (performance.now() - started < 1000 && performance.now() - stable < 160)
      return { performed: 'scroll', dx: last.left - before.left, dy: last.top - before.top }
    }

    let el = target
    let point: { x: number; y: number } | null
    if (el) point = reachablePoint(view, el)
    else {
      if (command !== 'tap' || !o.picture || o.picture.scope !== 'canvas' ||
          !allowed(view, o.picture.source) ||
          !sameRect(canvasRect(o.picture.source as HTMLCanvasElement), o.picture.rect) ||
          typeof args.x !== 'number' || typeof args.y !== 'number' ||
          !(args.x >= 0 && args.x <= 1 && args.y >= 0 && args.y <= 1)) {
        throw Error('请使用元素 ID，或先获取画布图片再按图中比例点击')
      }
      const r = o.picture.rect
      point = { x: r.left + Math.min(r.width - .5, args.x * r.width),
        y: r.top + Math.min(r.height - .5, args.y * r.height) }
      el = o.picture.source
    }
    if (!point) throw Error('目标被遮挡，请重新观察')
    const actual = hit(view, point.x, point.y)
    if (!actual || (actual !== el && !el.contains(actual))) throw Error('目标被遮挡，请重新观察')
    requireForeground(signal)
    if (command === 'tap') click(view, el, point.x, point.y)
    else if (command === 'fill' && typeof args.text === 'string' && args.text.length <= 4000) {
      feedback(view, point.x, point.y)
      fill(view, el, args.text)
    } else throw Error('不支持的网页动作')
    await nextTick()
    await settle(signal)
    return { performed: command, target: id || 'canvas', observeAgain: true }
  }

  return { clear, execute }
}
