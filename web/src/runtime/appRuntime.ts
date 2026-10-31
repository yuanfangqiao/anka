import { computed, markRaw, shallowReactive, watch } from 'vue'
import type { RouteLocationNormalizedLoaded, RouteLocationRaw, RouteLocationResolved, Router } from 'vue-router'
import { registry } from '../registry/appRegistry'
import { isMobile } from '../composables/useBreakpoint'
import { allowClose, lifecycle, publish } from './channels'
import type { AppRun, AppState } from './contracts'
import { createCapacityManager, MAX_RUNNING_APPS } from './capacity'

const runs = shallowReactive(new Map<string, AppRun>())
const state = shallowReactive({ focusedId: '', activeId: '', split: false, secondaryId: '', documentVisible: true })
let router: Router
let serial = 0
let loader: (id: string) => Promise<void> = async () => {}
let remember = (_id: string, _path: string, _replace: boolean) => {}
const snapshot = (route: RouteLocationNormalizedLoaded | RouteLocationResolved) =>
  markRaw({ ...route, name: route.name ?? undefined, meta: { ...route.meta } }) as RouteLocationNormalizedLoaded

function appState(id: string): AppState {
  const run = runs.get(id)
  return { appId: id, running: Boolean(run), visible: Boolean(run?.visible),
    focused: Boolean(run?.focused), foreground: Boolean(run?.visible && state.documentVisible),
    background: registry.byId(id)?.runtime?.background ?? 'pause' }
}

function notify(run: AppRun, previous?: AppState) {
  const next = appState(run.id)
  lifecycle(run.id, 'state', next)
  if (previous?.foreground !== next.foreground) lifecycle(run.id, next.foreground ? 'activate' : 'deactivate', next)
}

function visibility() {
  const rootVisible = (run: AppRun): boolean => run.parentId
    ? Boolean(runs.get(run.parentId)?.visible)
    : run.id === state.focusedId || (state.split && !isMobile.value && run.id === state.secondaryId)
  // Parents are inserted before their embedded descendants.
  for (const run of runs.values()) {
    const previous = appState(run.id)
    run.visible = rootVisible(run)
    run.focused = run.id === state.activeId
    if (previous.visible !== run.visible || previous.focused !== run.focused) notify(run, previous)
  }
}

async function prepare(id: string, path?: string, parentId?: string, preload = false) {
  const app = registry.byId(id)
  if (!app) throw new Error(`应用 ${id} 未安装`)
  const existing = runs.get(id)
  if (existing) return existing
  const route = router.resolve(path ?? app.route.replace(/\/:.*$/, ''))
  let created = false
  const run = await capacity.reserve(id, () => {
    created = true
    return shallowReactive<AppRun>({ id, key: ++serial, route: snapshot(route), status: 'loading',
      error: '', visible: false, focused: false, lastUsed: Date.now(), parentId })
  }, { preload, parentId })
  if (!created) return run
  try {
    await loader(id)
    if (runs.get(id) !== run) return run
    run.route = snapshot(router.resolve(path ?? route.fullPath))
    run.status = 'ready'
  } catch (error) {
    if (runs.get(id) === run) { run.status = 'error'; run.error = String(error instanceof Error ? error.message : error) }
  }
  if (runs.get(id) === run) { visibility(); notify(run) }
  return run
}

function remove(id: string) {
  for (const child of [...runs.values()]) if (child.parentId === id) remove(child.id)
  const run = runs.get(id)
  if (!run) return
  const previous = appState(id)
  run.visible = false
  run.focused = false
  notify(run, previous)
  runs.delete(id)
  if (state.activeId === id) state.activeId = state.focusedId === id ? '' : state.focusedId
  lifecycle(id, 'close', appState(id))
  if (state.secondaryId === id) state.secondaryId = ''
}

async function validateClose(id: string) {
  const descendants: AppRun[] = []
  const collect = (target: string) => {
    const run = runs.get(target)
    if (run) descendants.push(run)
    for (const child of runs.values()) if (child.parentId === target) collect(child.id)
  }
  collect(id)
  for (const run of descendants) await allowClose(run.id)
}

async function close(id: string) {
  await validateClose(id)
  if (state.focusedId === id) {
    const fallback = [...runs.values()].filter(run => run.id !== id && !run.parentId)
      .sort((a, b) => b.lastUsed - a.lastUsed)[0]
    if (fallback) await router.replace(fallback.route.fullPath)
    else { state.focusedId = ''; await router.replace('/?desktop=1') }
  }
  remove(id)
  visibility()
}

const capacity = createCapacityManager({ runs, validate: validateClose, remove,
  background: id => registry.byId(id)?.runtime?.background ?? 'pause' })

export const appRuntime = {
  runs, state, appState, maxRunningApps: MAX_RUNNING_APPS,
  running: computed(() => [...runs.values()]),
  configure(next: Router, record: typeof remember) {
    router = next
    remember = record
    watch(isMobile, visibility)
    document.addEventListener('visibilitychange', () => {
      const old = new Map([...runs].map(([id]) => [id, appState(id)]))
      state.documentVisible = document.visibilityState === 'visible'
      for (const run of runs.values()) notify(run, old.get(run.id))
    })
  },
  setLoader(next: typeof loader) { loader = next },
  load: (id: string) => loader(id),
  async syncRoute(route: RouteLocationNormalizedLoaded) {
    const id = route.meta.appId as string | undefined
    if (id === state.secondaryId) state.secondaryId = state.focusedId
    state.focusedId = id ?? ''
    state.activeId = id ?? ''
    if (!id) { visibility(); return }
    const existing = runs.get(id)
    if (existing?.parentId) throw new Error('内嵌应用不能同时作为主窗口打开')
    const pending = prepare(id, route.fullPath)
    visibility()
    const run = await pending
    if (runs.get(id) !== run) return
    run.route = snapshot(router.resolve(route.fullPath))
    run.lastUsed = Date.now()
    visibility()
    // Explicit opt-out releases only an inactive, unprotected instance.
    for (const other of [...runs.values()]) {
      if (!other.visible && !other.parentId && registry.byId(other.id)?.runtime?.keepAlive === false) {
        void validateClose(other.id).then(() => { if (!other.visible) remove(other.id) }).catch(() => {})
      }
    }
  },
  prepare: (id: string, path?: string) => prepare(id, path),
  prewarm: (id: string) => prepare(id, undefined, undefined, true),
  async embed(id: string, parentId: string) {
    if (id === parentId) throw new Error('应用不能嵌入自身')
    for (let parent = runs.get(parentId); parent; parent = parent.parentId ? runs.get(parent.parentId) : undefined) {
      if (parent.id === id) throw new Error('不允许循环嵌套')
    }
    const existing = runs.get(id)
    if (existing && existing.parentId !== parentId) throw new Error('应用已在其他窗口运行，请先关闭')
    const run = await prepare(id, undefined, parentId)
    visibility()
    return run
  },
  async open(id: string, path?: string) {
    const app = registry.byId(id)
    if (!app) throw new Error('应用未安装')
    let root = runs.get(id)
    if (root?.parentId) {
      if (path) await appRuntime.route(id, path, true)
      while (root.parentId) root = runs.get(root.parentId)!
      await router.replace(root.route.fullPath)
      appRuntime.focus(id)
      return
    }
    const target = path ?? runs.get(id)?.route.fullPath ?? app.route.replace(/\/:.*$/, '')
    if (router.resolve(target).meta.appId !== id) throw new Error('目标路径不属于指定应用')
    await router.replace(target)
  },
  async splitWith(id: string) {
    if (id === state.focusedId) throw new Error('请选择另一个应用分屏')
    if (runs.get(id)?.parentId) throw new Error('内嵌应用不能分屏')
    await prepare(id)
    state.secondaryId = id
    state.split = true
    visibility()
  },
  single() { state.split = false; visibility() },
  close,
  async restart(id: string) {
    const path = runs.get(id)?.route.fullPath
    const parentId = runs.get(id)?.parentId
    await close(id)
    if (parentId) await prepare(id, path, parentId)
    else if (path) await router.replace(path)
    else await appRuntime.open(id)
  },
  remove,
  focus(id: string) {
    let run = runs.get(id)
    if (!run?.visible) return
    state.activeId = id
    while (run) { run.lastUsed = Date.now(); run = run.parentId ? runs.get(run.parentId) : undefined }
    visibility()
  },
  fail(id: string, error: unknown) {
    const run = runs.get(id)
    if (run) { run.status = 'error'; run.error = error instanceof Error ? error.message : String(error) }
  },
  route(id: string, path: RouteLocationRaw, replace = false) {
    const resolved = router.resolve(path)
    if (resolved.meta.appId !== id) throw new Error('内部路由只能跳转当前应用，请用 switchApp 切应用')
    const run = runs.get(id)
    if (run && state.focusedId !== id) {
      run.route = snapshot(resolved)
      remember(id, resolved.fullPath, replace)
      publish(`$route:${id}`, resolved.fullPath)
      return Promise.resolve()
    }
    return replace ? router.replace(path) : router.push(path)
  },
}
