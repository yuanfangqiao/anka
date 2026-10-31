/** Observable capacity guarantees, without a browser or a user backend. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { transform } from 'esbuild'

const source = await readFile(new URL('../src/runtime/capacity.ts', import.meta.url), 'utf8')
const { code } = await transform(source, { loader: 'ts', format: 'esm' })
const { createCapacityManager, MAX_RUNNING_APPS, AppCapacityError } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const run = (id, index, extra = {}) => ({ id, key: index, lastUsed: index, visible: false, focused: false, status: 'ready', ...extra })
function setup(validate = async () => {}, background = () => 'pause') {
  const runs = new Map()
  const removed = []
  const remove = id => {
    removed.push(id)
    for (const child of [...runs.values()]) if (child.parentId === id) remove(child.id)
    runs.delete(id)
  }
  const manager = createCapacityManager({ runs, validate, background, remove })
  return { runs, removed, manager }
}
{
  const { runs, manager } = setup()
  const results = await Promise.allSettled(Array.from({ length: 25 }, (_, i) =>
    manager.reserve('app' + i, () => run('app' + i, i, { status: 'loading' }))))
  assert.equal(runs.size, MAX_RUNNING_APPS)
  assert.equal(results.filter(result => result.status === 'fulfilled').length, MAX_RUNNING_APPS)
  assert.equal(results.filter(result => result.status === 'rejected').length, 15)
  console.log('PASS 并发打开 25 个应用，包含加载中预留仍不超过 10 个')
}
{
  const { runs, removed, manager } = setup(async id => { if (id === 'app1') throw Error('未保存') })
  for (let i = 0; i < 10; i++) runs.set('app' + i, run('app' + i, i, { visible: i === 0 }))
  await manager.reserve('new', () => run('new', 20))
  assert.deepEqual(removed, ['app2'])
  assert.equal(runs.has('app0'), true)
  assert.equal(runs.has('app1'), true)
  assert.equal(runs.size, 10)
  console.log('PASS 跳过前台和关闭保护，回收最久未使用的可关闭后台应用')
}
{
  const { runs, removed, manager } = setup(async () => { throw Error('保护中') })
  for (let i = 0; i < 10; i++) runs.set('app' + i, run('app' + i, i))
  await assert.rejects(manager.reserve('new', () => run('new', 20)), AppCapacityError)
  assert.equal(runs.size, 10)
  assert.deepEqual(removed, [])
  console.log('PASS 全部应用受保护时拒绝新实例，已有应用不丢失')
}
{
  const { runs, removed, manager } = setup()
  for (let i = 0; i < 10; i++) runs.set('app' + i, run('app' + i, i))
  await assert.rejects(manager.reserve('preload', () => run('preload', 20), { preload: true }), AppCapacityError)
  assert.deepEqual(removed, [])
  console.log('PASS 预执行满额直接跳过，不挤掉用户已打开的应用')
}
{
  const { runs, removed, manager } = setup(async id => { if (id === 'app2') runs.get(id).lastUsed = 100 },
    id => id === 'app0' ? 'continue' : 'pause')
  for (let i = 0; i < 10; i++) runs.set('app' + i, run('app' + i, i))
  runs.get('app1').parentId = 'app0'
  await manager.reserve('child', () => run('child', 20, { parentId: 'app4' }), { parentId: 'app4' })
  assert.deepEqual(removed, ['app3'])
  assert.equal(runs.has('app0'), true)
  assert.equal(runs.has('app1'), true)
  assert.equal(runs.has('app2'), true)
  assert.equal(runs.has('app4'), true)
  console.log('PASS 继续运行、嵌套归属、关闭检查期间重新使用的应用均受保护')
}
