/** 浏览器导航回归：真实壳层 + Jot，API 使用隔离数据，不读写用户后端。
 * node scripts/check-navigation.mjs
 * Playwright 不在项目依赖中时，设置 ANKA_PLAYWRIGHT_MODULE 为其 ESM 入口。 */
import assert from 'node:assert/strict'
import { mkdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const { chromium } = await import(process.env.ANKA_PLAYWRIGHT_MODULE || 'playwright')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const production = process.env.ANKA_NAV_PRODUCTION === '1'
const removedApps = new Set()
function apiResponse(pathname) {
  if (pathname === '/api/auth/me') return { username: 'navigation-check' }
  if (pathname === '/api/apps') return [
    ...['demo1', 'demo2'].map(id => ({ id, title: id, kind: 'app', route: '/' + id,
      entry: '/__navigation_demo.js?id=' + id, dock_order: 30 })),
    { id: 'anka-jot', title: '即刻', kind: 'app', route: '/anka-jot',
      entry: production ? '/plugin-dist/anka-jot/index.js' : '/plugins/anka-jot/web/index.ts', dock_order: 10 },
  ].filter(app => !removedApps.has(app.id))
  if (pathname === '/api/settings') return { models: [], home_app: '', default_model: '' }
  if (pathname === '/api/config') return { mobile_dock_max: 6 }
  if (['/api/runs', '/api/sessions', '/api/plugins'].includes(pathname)) return []
  if (pathname.endsWith('/call')) return { ok: true,
    result: { notes: [], tags: [], nextRev: 0, hasMore: false, applied: true, serverRev: 1 } }
  return {}
}
const demoSource = `
export function setup(ctx) {
  window.__ankaNavigation = ctx.navigation;
  const id = new URL(import.meta.url).searchParams.get('id');
  const state = ctx.vue.reactive({ depth: 1 });
  const component = ctx.vue.defineComponent({ setup: () => () => ctx.vue.h('div', {
    'data-demo': id, style: 'padding:24px'
  }, [ctx.vue.h('p', {}, id + ':' + state.depth), ctx.vue.h('button', {
    'data-open-detail': id, onClick: () => { state.depth++ }
  }, '进入详情')]) });
  ctx.registerApp({ id, title: id, icon: 'package',
    route: '/' + id + (id === 'demo1' ? '/:page?' : ''), order: 30, component });
  if (id === 'demo2') ctx.navigation.register({
    appId: id, canGoBack: () => state.depth > 1, back: () => { state.depth-- }
  });
  return { teardown() { window.__fixtureTeardowns = (window.__fixtureTeardowns || 0) + 1 } };
}`
const server = await createServer({
  root, server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'navigation-check-fixture', configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      const pathname = new URL(req.url, 'http://localhost').pathname
      if (pathname === '/__navigation_demo.js') {
        res.setHeader('Content-Type', 'text/javascript'); res.end(demoSource); return
      }
      // SW 发起的请求同样得到隔离 API，不依赖 Playwright 对页面请求的拦截。
      if (pathname.startsWith('/api/')) {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(apiResponse(pathname))); return
      }
      if (!production) return next()
      const base = pathname.startsWith('/plugin-dist/') ? path.resolve(root, '../.plugin-dist') : path.join(root, 'dist')
      const relative = pathname.replace(/^\/plugin-dist\//, '')
      let file = path.resolve(base, '.' + (relative.startsWith('/') ? relative : '/' + relative))
      if (!file.startsWith(base + path.sep)) file = path.join(root, 'dist/index.html')
      try { if (!(await stat(file)).isFile()) throw new Error('not-file') }
      catch { file = path.join(root, 'dist/index.html') }
      const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html',
        '.json': 'application/json', '.webmanifest': 'application/manifest+json',
        '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }
      try {
        res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream')
        res.setHeader('Cache-Control', 'no-store')
        res.end(await readFile(file))
      } catch (e) { next(e) }
    })
  } }],
  logLevel: 'error',
})
let browser
try {
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true, channel: process.env.ANKA_BROWSER_CHANNEL || 'chrome' })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await context.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname
    await route.fulfill({ json: apiResponse(pathname) })
  })
  let shellSocket
  await context.routeWebSocket('**/api/sync/ws/**', ws => {
    shellSocket = ws
    ws.onMessage(() => ws.send(JSON.stringify({ type: 'pong' })))
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  if (process.env.ANKA_NAV_TRACE) {
    page.on('console', msg => console.log('[browser]', msg.text()))
    page.on('framenavigated', frame => console.log('[url]', frame.url()))
  }
  const navigate = (method, ...args) => page.evaluate(async ({ method, args }) => {
    return window.__ankaNavigation[method](...args)
  }, { method, args })
  const checkPath = expected => page.waitForFunction(
    expected => location.pathname + location.hash === expected, expected)
  const back = async () => {
    await page.evaluate(() => history.back())
    // 原生历史事件异步；等待回退处理完成后再断言稳定状态。
    await page.waitForTimeout(100)
  }

  await page.goto(origin + '/demo1')
  await page.locator('[data-demo="demo1"]').waitFor()
  await page.getByRole('button', { name: 'demo2', exact: true }).first().click()
  await checkPath('/demo2')
  const initialLength = await page.evaluate(() => history.length)
  await back()
  await checkPath('/demo2')
  assert.match(await page.locator('[data-demo="demo2"]').innerText(), /^demo2:1\s+进入详情$/)
  console.log('PASS 未接入应用切换后，系统返回保持当前插件')

  await page.locator('[data-open-detail="demo2"]').click()
  await back()
  assert.match(await page.locator('[data-demo="demo2"]').innerText(), /demo2:1/)
  await page.locator('[data-open-detail="demo2"]').click()
  await navigate('switchApp', 'demo1')
  await back()
  await checkPath('/demo1')
  await navigate('switchApp', 'demo2')
  assert.match(await page.locator('[data-demo="demo2"]').innerText(), /demo2:2/)
  await back()
  console.log('PASS 当前插件内部返回、后台插件隔离与切回状态恢复')

  await navigate('switchApp', 'demo1')
  await navigate('push', '/demo1/detail')
  await navigate('push', '/demo1/edit')
  await navigate('switchApp', 'demo2')
  await back()
  await checkPath('/demo2')
  await navigate('switchApp', 'demo1')
  await checkPath('/demo1/edit')
  await back()
  await checkPath('/demo1/detail')
  await back()
  await checkPath('/demo1')
  console.log('PASS 路由型插件的独立多级栈与切回恢复')

  await navigate('switchApp', 'settings')
  await navigate('push', '/settings/client')
  await back()
  await checkPath('/settings')
  await back()
  await checkPath('/settings')
  await page.reload()
  await page.getByRole('button', { name: 'demo2', exact: true }).first().waitFor()
  assert.equal(await page.evaluate(() => history.length), initialLength)
  await navigate('replace', '/settings/client')
  await page.reload()
  await page.getByRole('button', { name: 'demo2', exact: true }).first().waitFor()
  await back()
  await checkPath('/settings')
  console.log('PASS 控制台内部返回、深链刷新与历史边界复用')

  // 真实 Jot 内部栈，使用本测试浏览器独立的 IndexedDB。
  await navigate('switchApp', 'anka-jot')
  await page.getByRole('button', { name: '搜索文字、语音、OCR…', exact: true }).click()
  await checkPath('/anka-jot#/search')
  await navigate('switchApp', 'demo1')
  await navigate('switchApp', 'anka-jot')
  await checkPath('/anka-jot#/search')
  await back()
  await checkPath('/anka-jot#/home')
  await page.getByRole('button', { name: '搜索文字、语音、OCR…', exact: true }).click()
  await checkPath('/anka-jot#/search')
  await page.reload()
  await page.getByRole('button', { name: 'demo2', exact: true }).first().waitFor()
  await back()
  await checkPath('/anka-jot#/home')
  console.log('PASS Jot 内部返回、应用切回与深链刷新恢复')

  await page.evaluate(async () => {
    window.__overlayOpen = true
    window.__removeOverlay = window.__ankaNavigation.registerOverlay({
      canGoBack: () => window.__overlayOpen,
      back: () => { window.__overlayOpen = false },
    })
  })
  await back()
  assert.equal(await page.evaluate(() => window.__overlayOpen), false)
  await checkPath('/anka-jot#/home')
  await page.evaluate(() => window.__removeOverlay())
  for (let i = 0; i < 5; i++) await back()
  assert.equal(await page.evaluate(() => history.length), initialLength)
  assert.equal(await navigate('back'), false)
  console.log('PASS 弹层优先、根页面连续返回与历史长度稳定')

  await page.evaluate(async () => {
    window.__oldCalls = 0
    window.__ankaNavigation.register({ appId: 'demo2', canGoBack: () => true,
      back: () => { window.__oldCalls++ }, priority: 100 })
  })
  removedApps.add('demo2')
  shellSocket.send(JSON.stringify({ type: 'plugins-changed', action: 'uninstall', name: 'demo2' }))
  await page.waitForFunction(() => window.__fixtureTeardowns === 1)
  await page.waitForFunction(() => !document.querySelector('button[aria-label="demo2"]'))
  removedApps.delete('demo2')
  shellSocket.send(JSON.stringify({ type: 'plugins-changed', action: 'install', name: 'demo2' }))
  await page.getByRole('button', { name: 'demo2', exact: true }).first().waitFor()
  await navigate('switchApp', 'demo2')
  await back()
  assert.equal(await page.evaluate(() => window.__oldCalls), 0)
  console.log('PASS 实际卸载 teardown、清理返回处理器与重新安装')

  const screenshots = process.env.ANKA_NAV_SCREENSHOTS
  if (screenshots) {
    await mkdir(screenshots, { recursive: true })
    await navigate('switchApp', 'settings')
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(screenshots, 'navigation-mobile.png') })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(screenshots, 'navigation-desktop.png') })
  }
  if (production) {
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready
      if (registration.active?.state !== 'activated') throw new Error('SW 未激活')
      const manifest = await (await fetch('/manifest.webmanifest')).json()
      if (manifest.display !== 'standalone') throw new Error('manifest 不可用')
    })
    console.log('PASS 生产构建 Service Worker 激活与 manifest 可读')
  }
  assert.deepEqual(errors, [], '浏览器不应出现未捕获异常')
} finally {
  await browser?.close()
  await server.close()
}
