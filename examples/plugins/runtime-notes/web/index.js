/** Native runtime example: draft, lifecycle, close guard, commands, and app-owned portal. */
export function setup(ctx) {
  const { defineComponent, h, ref, computed } = ctx.vue
  const draft = ref(ctx.storage.get('draft')?.text || '')
  const saved = ref(draft.value)
  const save = () => { ctx.storage.set('draft', { text: draft.value }); saved.value = draft.value; return { saved: true } }
  const stopCommand = ctx.commands.register('save', save)
  const component = defineComponent({
    setup() {
      const showHelp = ref(false)
      const state = computed(() => ctx.lifecycle.state.value)
      ctx.lifecycle.beforeClose(() => draft.value === saved.value || '笔记尚未保存，请先点击保存')
      return () => h('div', { style: 'max-width:720px;margin:auto;padding:24px;height:100%;overflow:auto' }, [
        h('h1', { style: 'font-size:24px;font-weight:600' }, '保活笔记示例'),
        h('p', { style: 'margin:12px 0;opacity:.65' }, state.value.foreground ? '正在前台使用' : '后台保留'),
        h('textarea', { value: draft.value, 'aria-label': '笔记草稿',
          style: 'width:100%;height:240px;padding:16px;border:1px solid #8886;border-radius:16px;background:transparent',
          onInput: event => { draft.value = event.target.value } }),
        h('div', { style: 'display:flex;gap:16px;margin-top:12px' }, [
          h(ctx.components.BaseButton, { onClick: save }, () => '保存'),
          h(ctx.components.BaseButton, { onClick: () => { showHelp.value = true } }, () => '使用说明'),
        ]),
        h('p', { style: 'margin-top:20px;opacity:.65' }, '输入文字后切换到别的应用，再回来：草稿、光标和滚动位置保持不变。保存后刷新也能恢复。'),
        showHelp.value ? h(ctx.components.AppPortal, {}, () => h('div', {
          style: 'position:fixed;inset:15%;z-index:100;background:#202635;color:white;padding:24px;border-radius:20px'
        }, [h('p', {}, '这个弹层会跟随应用隐藏。关闭未保存的应用时，系统会提醒先保存。'),
          h('button', { onClick: () => { showHelp.value = false }, style: 'margin-top:20px' }, '关闭说明')])) : null,
      ])
    },
  })
  ctx.registerApp({ id: ctx.appId, title: '保活笔记示例', icon: 'notebook-pen', route: '/runtime-notes', component, order: 70 })
  return { teardown() { stopCommand() } }
}
