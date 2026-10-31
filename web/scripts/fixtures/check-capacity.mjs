import assert from 'node:assert/strict'

export async function checkCapacity({ page, open, app }) {
  await open('alpha')
  await page.waitForFunction(() => window.__runtimeLoads.warm === 1)
  await page.evaluate(async () => {
    const ctx = window.__runtimeContexts.alpha
    for (const run of ctx.apps.list()) if (run.appId !== 'alpha') await ctx.apps.close(run.appId)
    window.__capacityStops = [ctx.lifecycle.beforeClose(() => false)]
  })
  for (let i = 1; i <= 9; i++) await open('limit-' + i)
  assert.equal(await page.evaluate(() => window.__runtimeContexts.alpha.apps.list().length), 10)
  await open('limit-1')
  await page.getByRole('textbox', { name: 'limit-1草稿', exact: true }).fill('最近使用的草稿')
  await open('limit-10')
  assert.equal(await page.locator('[data-app-window="limit-2"]').count(), 0)
  assert.equal(await page.locator('[data-app-window="alpha"]').count(), 1)
  assert.equal(await page.locator('[data-dock-indicator="limit-2"]').first().getAttribute('data-state'), 'closed')
  await open('limit-1')
  assert.equal(await page.getByRole('textbox', { name: 'limit-1草稿', exact: true }).inputValue(), '最近使用的草稿')
  await page.evaluate(() => {
    for (const run of window.__runtimeContexts.alpha.apps.list()) {
      window.__capacityStops.push(window.__runtimeContexts[run.appId].lifecycle.beforeClose(() => false))
    }
  })
  const previous = page.url()
  await page.getByRole('button', { name: 'limit-11', exact: true }).first().click()
  await page.getByText('已达到 10 个运行应用上限，请先保存或关闭后台应用', { exact: true }).waitFor()
  assert.equal(page.url(), previous)
  assert.equal(await app('limit-1').isVisible(), true)
  assert.equal(await page.locator('[data-app-window="limit-11"]').count(), 0)
  assert.equal(await page.evaluate(() => window.__runtimeLoads['limit-11']), undefined)
  assert.equal(await page.evaluate(() => window.__runtimeContexts.alpha.apps.list().length), 10)
  await page.evaluate(() => { for (const stop of window.__capacityStops) stop() })
  await open('limit-11')
  assert.equal(await app('limit-11').isVisible(), true)
  assert.equal(await page.evaluate(() => window.__runtimeContexts.alpha.apps.list().length), 10)
  console.log('PASS 10 个界面上限、LRU 回收、保护草稿、满额拒绝不执行 setup，解除保护后可继续打开')
}
