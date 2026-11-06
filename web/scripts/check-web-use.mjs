/** Real Chrome + production Anka + FastAPI/WS + deterministic model; isolated data. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const { chromium } = await import(process.env.ANKA_PLAYWRIGHT_MODULE || 'playwright')
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.dirname(web)
await access(path.join(web, 'dist/index.html'))
const temp = await mkdtemp(path.join(tmpdir(), 'anka-web-use-'))
let server, browser
let logs = ''
try {
  const plugin = path.join(temp, 'plugins/web-use-demo')
  await mkdir(plugin, { recursive: true })
  await cp(path.join(web, 'scripts/fixtures/web-use-page.html'), path.join(plugin, 'index.html'))
  server = spawn(process.env.ANKA_PYTHON || path.join(root, '.venv/bin/python'),
    [path.join(web, 'scripts/fixtures/web-use-backend.py')], {
      cwd: path.join(root, 'server'),
      env: { ...process.env, PYTHONPATH: path.join(root, 'server'), AGENTOS_DEV: '0', DEBUG_DISABLE_AUTH: '0',
        ANKA_DATA_DIR: path.join(temp, 'data'), ANKA_PLUGINS_DIR: path.join(temp, 'plugins'),
        ANKA_USERS_FILE: path.join(temp, 'auth/users.json') },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  server.stderr.on('data', value => { logs = (logs + value).slice(-12000) })
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('后端启动超时')), 10000)
    server.once('error', error => { clearTimeout(timer); reject(error) })
    server.once('exit', code => { clearTimeout(timer); reject(Error('后端退出：' + code)) })
    server.stdout.on('data', value => {
      const match = String(value).match(/WEB_USE_PORT=(\d+)/)
      if (match) { clearTimeout(timer); resolve(Number(match[1])) }
    })
  })
  const base = 'http://127.0.0.1:' + port
  for (let i = 0; ; i++) {
    try { if ((await fetch(base + '/api/health')).ok) break } catch {}
    if (i === 80) throw Error('后端未就绪')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  browser = await chromium.launch({ channel: process.env.ANKA_BROWSER_CHANNEL || 'chrome', headless: true })
  const guest = await browser.newContext()
  assert.equal((await guest.request.post(base + '/api/chat', { data: { message: '未登录' } })).status(), 401)
  const other = await browser.newContext()
  const login = async (context, username) => {
    const res = await context.request.post(base + '/api/auth/login', {
      data: { username, password: 'web-use-fixture' },
    })
    assert.equal(res.status(), 200, await res.text())
  }
  await login(other, 'other-qa')
  const setup = await browser.newContext()
  await login(setup, 'web-use-qa')
  const installed = await setup.request.post(base + '/api/plugins/web-use-demo/install')
  assert.equal(installed.status(), 200, await installed.text())
  assert.ok((await (await setup.request.get(base + '/api/apps')).json()).some(app => app.id === 'web-use-demo'))
  await setup.close()

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, hasTouch: viewport.width < 500, serviceWorkers: 'block' })
    await login(context, 'web-use-qa')
    await context.addInitScript(() => sessionStorage.setItem('pwa-standalone-hint', '1'))
    const page = await context.newPage()
    const errors = []
    let client
    page.on('pageerror', error => errors.push(error.message))
    page.on('websocket', ws => {
      if (ws.url().includes('/api/web-use/ws')) ws.on('framereceived', ({ payload }) => {
        const msg = JSON.parse(payload.toString())
        if (msg.type === 'ready') client = msg.clientId
      })
    })
    await page.goto(base + '/chat')
    const toggle = page.getByRole('button', { name: '网页操作', exact: true })
    await toggle.click()
    await toggle.getByText('网页操作已开', { exact: true }).waitFor()
    assert.ok(client)
    assert.equal((await other.request.post(base + '/api/chat', { headers: { Origin: base },
      data: { message: '不能控制别人的窗口', web_client_id: client } })).status(), 409)
    assert.equal((await context.request.post(base + '/api/chat', { headers: { Origin: 'https://other.invalid' },
      data: { message: '不允许跨站请求', web_client_id: client } })).status(), 403)

    await page.getByPlaceholder(/给 Agent 发条消息/).fill('打开找茬并操作')
    const started = page.waitForResponse(res => res.url().endsWith('/api/chat') && res.request().method() === 'POST')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    const response = await started
    assert.equal(response.status(), 200, await response.text())
    const run = await response.json()
    const stream = await context.request.get(base + '/api/runs/' + run.run_id + '/stream', { timeout: 20_000 })
    const events = (await stream.text()).split('\n').filter(line => line.startsWith('data: '))
      .map(line => JSON.parse(line.slice(6)))
    assert.ok(events.some(event => event.type === 'text_delta' && event.content === '网页操作验收完成'),
      JSON.stringify(events.filter(event => event.type === 'error' || event.type === 'tool_result')))
    const frame = page.frameLocator('iframe[data-web-use-frame="web-use-demo"]')
    await frame.locator('#score').filter({ hasText: '1/1' }).waitFor()
    assert.equal(await frame.locator('#search').inputValue(), '海边')
    assert.ok(await frame.locator('#levels').evaluate(el => el.scrollTop) > 130)
    assert.equal((await other.request.post(base + '/api/runs/' + run.run_id + '/stop')).status(), 404)
    const sessions = await readdir(path.join(temp, 'data/ai/sessions'))
    assert.ok(sessions.includes(run.session_id + '.jsonl'))
    const history = await readFile(path.join(temp, 'data/ai/sessions', run.session_id + '.jsonl'), 'utf8')
    assert.doesNotMatch(history, /base64|关卡列表|observation-/)
    assert.deepEqual(errors, [])
    console.log('PASS ' + viewport.width + '×' + viewport.height + '：真实 WSS → iframe 导航、中文输入、滚动、Canvas 画面回传、坐标点击、拒绝旧观察')
    await context.close()
  }
} catch (error) {
  console.error(logs)
  throw error
} finally {
  await browser?.close()
  if (server && server.exitCode === null && server.pid) {
    const closed = once(server, 'exit')
    server.kill()
    await closed
  }
  await rm(temp, { recursive: true, force: true })
}
