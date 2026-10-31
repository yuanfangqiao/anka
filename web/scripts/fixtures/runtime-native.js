window.__runtimeEvaluations ??= {}
window.__runtimeEvaluations[new URL(import.meta.url).searchParams.get('id')] = true
export function setup(ctx) {
  const id = new URL(import.meta.url).searchParams.get('id')
  if (id === 'broken' && !window.__repairBroken) throw new Error('示例启动失败')
  window.__runtimeContexts ??= {}
  window.__runtimeContexts[id] = ctx
  window.__runtimeLoads ??= {}
  window.__runtimeLoads[id] = (window.__runtimeLoads[id] || 0) + 1
  ctx.commands.register('echo', value => ({ provider: id, value }))
  const component = ctx.vue.defineComponent({
    setup() {
      const value = ctx.vue.ref('')
      const received = ctx.vue.ref('')
      const events = ctx.vue.ref([])
      ctx.lifecycle.on('state', state => { events.value.push(state.foreground ? 'front' : 'back') })
      ctx.events.on('test:message', event => { received.value = event.source + ':' + event.data })
      ctx.vue.onUnmounted(() => { window.__runtimeUnmounts ??= {}; window.__runtimeUnmounts[id] = (window.__runtimeUnmounts[id] || 0) + 1 })
      return () => ctx.vue.h('div', { 'data-runtime-fixture': id, style: 'padding:24px;min-height:100%' }, [
        ctx.vue.h('h1', {}, id),
        ctx.vue.h('textarea', { 'aria-label': id + '草稿', value: value.value, onInput: e => { value.value = e.target.value } }),
        ctx.vue.h('p', { 'data-received': id }, received.value),
        ctx.vue.h('p', { 'data-lifecycle': id }, events.value.join(',')),
        ctx.vue.h('p', { 'data-local-route': id }, ctx.route.value),
        id.endsWith('container') ? ctx.vue.h('div', { style: 'height:300px' }, [ctx.vue.h(ctx.components.AppEmbed, { appId: 'nested' })]) : null,
        id === 'alpha' ? ctx.vue.h(ctx.components.AppPortal, {}, () => ctx.vue.h('span', {
          'data-test-portal': id, style: 'position:fixed;right:12px;top:12px'
        }, 'alpha快捷操作')) : null,
        ctx.vue.h('div', { style: 'height:1400px' }, '可滚动内容'),
      ])
    },
  })
  ctx.registerApp({ id, title: id, icon: 'package', route: '/' + id + '/:page?', component, order: 10 })
}
