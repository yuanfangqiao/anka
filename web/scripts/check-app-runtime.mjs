/** Isolated browser integration: real host, fake catalog, no user backend or plugin data. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { checkCapacity } from './fixtures/check-capacity.mjs'

const { chromium } = await import(process.env.ANKA_PLAYWRIGHT_MODULE || 'playwright')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const production = process.env.ANKA_RUNTIME_PRODUCTION === '1'
const removed = new Set()
let alphaVersion = 1
const requested = new Set()
const catalog = () => [
  ...['alpha', 'beta'].map(id => ({ id, title: id, route: '/' + id, kind: 'app',
    entry: '/__runtime-native.js?id=' + id + (id === 'alpha' ? '&v=' + alphaVersion : ''), dock_order: 10, runtime: { preload: 'none' } })),
  { id: 'page', title: '网页应用', route: '/app/page', kind: 'page', entry: '/plugins/__runtime-page.html', dock_order: 20, runtime: { preload: 'none' } },
  { id: 'nested', title: '嵌套网页', route: '/app/nested', kind: 'page', entry: '/plugins/__runtime-page.html', dock_order: 25, runtime: { preload: 'none' } },
  ...['warm', 'container', 'resource', 'broken', 'guarded-container'].map(id => ({ id, title: id, route: '/' + id, kind: 'app',
    entry: '/__runtime-native.js?id=' + id, dock_order: 30,
    runtime: { keepAlive: id !== 'guarded-container', preload: id === 'warm' ? 'execute' : id === 'resource' ? 'resources' : 'none' } })),
  ...Array.from({ length: 12 }, (_, i) => { const id = 'limit-' + (i + 1); return { id, title: id, route: '/' + id, kind: 'app', entry: '/__runtime-native.js?id=' + id, dock_order: 50, runtime: { preload: 'none' } } }),
].filter(app => !removed.has(app.id))
function api(url) {
  if (url === '/api/auth/me') return { username: 'runtime-test' }
  if (url === '/api/apps') return catalog()
  if (url === '/api/settings') return { models: [], home_app: '', default_model: '' }
  if (url === '/api/config') return { mobile_dock_max: 6 }
  return []
}
const cacheDir = await mkdtemp(path.join(tmpdir(), 'anka-runtime-vite-'))
const server = await createServer({ root, cacheDir, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error',
  plugins: [{ name: 'app-runtime-fixtures', configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, 'http://localhost').pathname
      if (url === '/__runtime-native.js' || url === '/plugins/__runtime-page.html') {
        requested.add(new URL(req.url, 'http://localhost').searchParams.get('id'))
        res.setHeader('Content-Type', url.endsWith('.js') ? 'text/javascript' : 'text/html')
        res.end(await readFile(path.join(root, 'scripts/fixtures', url.endsWith('.js') ? 'runtime-native.js' : 'runtime-page.html')))
        return
      }
      if (url.startsWith('/api/')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(api(url))); return }
      if (!production) return next()
      let file = path.resolve(root, 'dist', '.' + url)
      if (!file.startsWith(path.join(root, 'dist') + path.sep)) return next()
      try { if (!(await stat(file)).isFile()) throw Error() } catch { file = path.join(root, 'dist/index.html') }
      const mime = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' }
      res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream')
      res.end(await readFile(file))
    })
  } }],
})
let browser
try {
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true, channel: process.env.ANKA_BROWSER_CHANNEL || 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript(() => sessionStorage.setItem('pwa-standalone-hint', '1'))
  let shell
  await context.routeWebSocket('**/api/sync/ws/**', ws => { shell = ws; ws.onMessage(() => ws.send('{"type":"pong"}')) })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  if (process.env.ANKA_RUNTIME_TRACE) page.on('console', msg => console.log('[browser]', msg.text()))
  const open = async id => {
    await page.getByRole('button', { name: id === 'page' ? '网页应用' : id === 'settings' ? '控制台' : id, exact: true }).first().click()
    await page.locator(`[data-app-window="${id}"]`).waitFor({ state: 'visible' })
  }
  const app = id => page.locator(`[data-app-window="${id}"]`)
  const showMenu = async id => {
    const name = id === 'page' ? '网页应用' : id
    await page.getByRole('button', { name, exact: true }).first().click({ button: 'right' })
    await page.getByRole('menu', { name: name + '操作', exact: true }).waitFor()
  }
  await page.goto(origin + '/alpha')
  assert.equal(await page.getByRole('button', { name: '运行中的应用', exact: true }).count(), 0)
  await page.getByRole('textbox', { name: 'alpha草稿', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.__runtimeLoads.beta), undefined, '未打开的插件不能执行 setup')
  await page.getByRole('textbox', { name: 'alpha草稿', exact: true }).fill('未保存的文字')
  await app('alpha').evaluate(el => { el.scrollTop = 400; window.originalApp = el.firstElementChild })
  await open('beta')
  assert.equal(await page.locator('[data-dock-indicator="alpha"]').first().getAttribute('data-state'), 'background')
  assert.equal(await page.locator('[data-dock-indicator="beta"]').first().getAttribute('data-state'), 'active')
  assert.equal(await page.locator('[data-test-portal="alpha"]').isVisible(), false)
  await page.getByRole('textbox', { name: 'beta草稿', exact: true }).fill('另一个应用的草稿')
  await open('alpha')
  assert.equal(await page.getByRole('textbox', { name: 'alpha草稿', exact: true }).inputValue(), '未保存的文字')
  assert.equal(await app('alpha').evaluate(el => el.scrollTop), 400)
  assert.equal(await app('alpha').evaluate(el => el.firstElementChild === window.originalApp), true)
  assert.equal(await page.evaluate(() => window.__runtimeUnmounts?.alpha || 0), 0)
  assert.equal(await page.locator('[data-test-portal="alpha"]').isVisible(), true)
  await page.waitForFunction(() => window.__runtimeLoads.warm === 1)
  assert.equal(await app('warm').isVisible(), false)
  await page.waitForFunction(() => Boolean(document.querySelector('link[data-anka-preload="resource"]')))
  assert.equal(requested.has('resource'), true)
  assert.equal(await page.evaluate(() => window.__runtimeEvaluations.resource), undefined)
  console.log('PASS 按需初始化、原生组件实例、草稿和滚动位置保活')

  await page.evaluate(() => window.__runtimeContexts.alpha.navigation.push('/alpha/detail'))
  await open('settings')
  await page.getByRole('button', { name: '客户端', exact: true }).first().click()
  await open('beta')
  assert.match(await app('alpha').locator('[data-local-route="alpha"]').innerText(), /\/alpha\/detail$/)
  await open('settings')
  assert.match(page.url(), /\/settings\/client$/)
  assert.match(await app('settings').innerText(), /安装与版本更新/)
  console.log('PASS 后台路由隔离、控制台二级路由恢复')

  await open('page')
  const frame = page.frameLocator('iframe[title="网页应用"]')
  await frame.locator('#detail').waitFor()
  await page.waitForFunction(() => document.querySelector('iframe[title="网页应用"]').contentWindow.sdkReady)
  const identity = await frame.locator('body').evaluate(() => window.pageIdentity)
  await frame.getByRole('textbox', { name: '网页草稿', exact: true }).fill('iframe 内存草稿')
  await frame.locator('#detail').click()
  await frame.locator('#path').filter({ hasText: '/detail/42' }).waitFor()
  await page.waitForURL(/__app=/)
  await open('alpha')
  await open('page')
  assert.equal(await frame.locator('body').evaluate(() => window.pageIdentity), identity)
  assert.equal(await frame.getByRole('textbox', { name: '网页草稿', exact: true }).inputValue(), 'iframe 内存草稿')
  await page.evaluate(() => history.back())
  await frame.locator('#path').filter({ hasText: /^\/$/ }).waitFor()
  assert.match(page.url(), /\/app\/page$/)
  console.log('PASS iframe 文档保活、虚拟路由、系统返回和链接同步')

  await frame.locator('#send').click()
  await page.waitForFunction(() => document.querySelector('[data-received="alpha"]').textContent === 'page:hello')
  await page.evaluate(() => window.__runtimeContexts.alpha.events.emit('test:message', 'native'))
  await frame.locator('#message').filter({ hasText: 'alpha:native' }).waitFor()
  assert.equal(await page.evaluate(() => window.__runtimeContexts.alpha.commands.execute('page:double', 21)), 42)
  await frame.locator('body').evaluate(async () => {
    await anka.storage.set('draft', { text: 'saved' })
    window.savedDraft = await anka.storage.get('draft')
  })
  assert.deepEqual(await frame.locator('body').evaluate(() => window.savedDraft), { text: 'saved' })
  assert.equal(await page.evaluate(() => window.__runtimeContexts.alpha.storage.get('draft')), null)
  console.log('PASS 原生/网页双向事件、跨应用命令和按应用隔离的存储')

  await frame.locator('body').evaluate(() => { window.protectDraft = true })
  await showMenu('page')
  await page.getByRole('menuitem', { name: '关闭网页应用', exact: true }).click()
  await page.getByText('请先保存网页草稿', { exact: true }).last().waitFor()
  assert.equal(await frame.locator('body').evaluate(() => window.pageIdentity), identity)
  await frame.locator('body').evaluate(() => { window.protectDraft = false })
  await page.getByRole('menuitem', { name: '关闭网页应用', exact: true }).click()
  await page.locator('iframe[title="网页应用"]').waitFor({ state: 'detached' })
  await page.keyboard.press('Escape')
  await open('page')
  await page.waitForFunction(() => document.querySelector('iframe[title="网页应用"]').contentWindow.sdkReady)
  assert.notEqual(await frame.locator('body').evaluate(() => window.pageIdentity), identity)
  console.log('PASS 关闭保护、释放 iframe、重新打开创建新文档')

  await open('alpha')
  await showMenu('page')
  await page.getByRole('menuitem', { name: '分屏显示网页应用', exact: true }).click()
  await page.locator('[data-workspace="split"]').waitFor()
  assert.equal(await app('alpha').isVisible(), true)
  assert.equal(await app('page').isVisible(), true)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('[data-workspace="single"]').waitFor()
  assert.equal(await app('page').isVisible(), false)
  const touchTarget = page.getByRole('button', { name: 'alpha', exact: true }).first()
  await touchTarget.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 160, clientY: 800 })
  await page.getByRole('menu', { name: 'alpha操作', exact: true }).waitFor()
  await touchTarget.dispatchEvent('pointerup', { pointerType: 'touch' })
  await touchTarget.dispatchEvent('click')
  assert.equal(await page.getByRole('menu', { name: 'alpha操作', exact: true }).isVisible(), true)
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.locator('[data-workspace="split"]').waitFor()
  console.log('PASS 桌面分屏、手机单窗口、跨断点不重建文档')

  await open('container')
  const nested = page.frameLocator('iframe[title="嵌套网页"]')
  await nested.locator('#detail').waitFor()
  await page.waitForFunction(() => document.querySelector('iframe[title="嵌套网页"]').contentWindow.sdkReady)
  await nested.getByRole('textbox', { name: '网页草稿', exact: true }).fill('嵌套草稿')
  await nested.locator('#detail').click()
  await nested.locator('#path').filter({ hasText: '/detail/42' }).waitFor()
  assert.match(page.url(), /\/container$/)
  await page.evaluate(() => history.back())
  await nested.locator('#path').filter({ hasText: /^\/$/ }).waitFor()
  await open('alpha')
  await open('container')
  assert.equal(await nested.getByRole('textbox', { name: '网页草稿', exact: true }).inputValue(), '嵌套草稿')
  await page.getByRole('button', { name: '嵌套网页', exact: true }).first().click()
  assert.match(page.url(), /\/container$/)
  await nested.locator('body').evaluate(() => { window.protectDraft = true })
  await showMenu('container')
  await page.getByRole('menuitem', { name: '关闭container', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('iframe[title="嵌套网页"]')?.contentWindow.guardCalls > 0)
  await page.waitForFunction(() => document.querySelector('[aria-label="关闭container"]')?.disabled === false)
  await page.getByText('请先保存网页草稿', { exact: true }).last().waitFor()
  await nested.locator('body').evaluate(() => { window.protectDraft = false })
  await page.getByRole('menuitem', { name: '关闭container', exact: true }).click()
  await page.locator('iframe[title="嵌套网页"]').waitFor({ state: 'detached' })
  await page.keyboard.press('Escape')
  console.log('PASS 选择性预执行、应用弹层随后台隐藏、嵌套应用路由/保活/关闭保护')

  await open('guarded-container')
  await page.waitForFunction(() => document.querySelector('iframe[title="嵌套网页"]')?.contentWindow.sdkReady)
  await nested.locator('body').evaluate(() => { window.protectDraft = true })
  await page.waitForFunction(() => document.querySelector('iframe[title="嵌套网页"]')?.contentWindow.anka)
  await open('alpha')
  await page.waitForFunction(() => document.querySelector('iframe[title="嵌套网页"]')?.contentWindow.guardCalls > 0)
  assert.equal(await page.locator('iframe[title="嵌套网页"]').count(), 1)
  await open('guarded-container')
  await nested.locator('body').evaluate(() => { window.protectDraft = false })
  await open('alpha')
  await page.locator('iframe[title="嵌套网页"]').waitFor({ state: 'detached' })
  console.log('PASS 放弃保活的应用仍遵守嵌套子应用关闭保护')

  if (process.env.ANKA_RUNTIME_SCREENSHOTS) {
    const out = path.resolve(process.env.ANKA_RUNTIME_SCREENSHOTS)
    await mkdir(out, { recursive: true })
    await open('alpha')
    await app('alpha').evaluate(el => { el.scrollTop = 0 })
    await page.screenshot({ path: path.join(out, 'desktop.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: path.join(out, 'mobile.png') })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await open('alpha')
  alphaVersion = 2
  shell.send(JSON.stringify({ type: 'plugins-changed', action: 'build', name: 'alpha' }))
  await showMenu('alpha')
  await page.locator('[data-app-menu="alpha"]').getByText(/有更新/).waitFor()
  assert.equal(await page.getByRole('textbox', { name: 'alpha草稿', exact: true }).inputValue(), '未保存的文字')
  await page.getByRole('menuitem', { name: '重新启动alpha', exact: true }).click()
  await page.waitForFunction(() => window.__runtimeLoads.alpha === 2)
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('textbox', { name: 'alpha草稿', exact: true }).inputValue(), '')
  console.log('PASS 更新保留运行中草稿，显式重新启动后才应用新版本')

  await open('broken')
  await app('broken').getByRole('alert').filter({ hasText: '示例启动失败' }).waitFor()
  await page.evaluate(() => { window.__repairBroken = true })
  await app('broken').getByRole('button', { name: '重新启动', exact: true }).click()
  await page.getByRole('textbox', { name: 'broken草稿', exact: true }).waitFor()
  console.log('PASS 单应用初始化失败兜底与重新启动，不影响其他运行应用')
  removed.add('beta')
  shell.send(JSON.stringify({ type: 'plugins-changed', action: 'uninstall', name: 'beta' }))
  await page.locator('[data-app-window="beta"]').waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => window.__runtimeContexts.alpha.commands.list().includes('beta:echo')), false)
  assert.deepEqual(errors, [])
  console.log('PASS 卸载后台应用清理实例与命令，无未处理页面异常')
  await open('page')
  await frame.locator('body').evaluate(async () => {
    await anka.navigation.push('/shared/99')
    await anka.storage.set('checkpoint', { value: 99 })
  })
  await page.reload()
  await page.waitForFunction(() => document.querySelector('iframe[title="网页应用"]')?.contentWindow.sdkReady)
  assert.equal(await frame.locator('#path').innerText(), '/shared/99')
  assert.deepEqual(await frame.locator('body').evaluate(() => anka.storage.get('checkpoint')), { value: 99 })
  await page.evaluate(() => history.back())
  await frame.locator('#path').filter({ hasText: /^\/$/ }).waitFor()
  assert.deepEqual(errors, [])
  console.log('PASS 网页深链刷新恢复、持久数据恢复与刷新后的系统返回')
  await checkCapacity({ page, open, app })
  assert.deepEqual(errors, [])
} finally { await browser?.close(); await server.close(); await rm(cacheDir, { recursive: true, force: true }) }
