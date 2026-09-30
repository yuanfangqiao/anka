/**
 * notes 插件前端入口（无构建器：不 import 任何 npm 包）
 * 一切依赖由内核经 uiCtx 注入：vue / components / icons / api / layout
 * M7：布局权下放——主界面自己画左栏（桌面）或退化为全屏（手机）
 */
export function setup(uiCtx) {
  const { vue, components, icons, api, toast, layout } = uiCtx
  const { defineComponent, h, reactive, computed, onMounted } = vue
  const { BaseCard, BasePanel } = components
  const { Pin, Plus, Search, Trash2, MessageSquareText } = icons

  const state = reactive({ notes: [], keyword: '', tag: '全部', loaded: false })

  async function refresh() {
    const data = await api.getAppState('notes')
    state.notes = data.notes || []
    state.loaded = true
  }
  async function call(method, args = {}) {
    await api.callApp('notes', method, args)
    await refresh()
  }

  const filtered = computed(() => {
    const k = state.keyword.trim()
    return state.notes.filter((n) => {
      if (state.tag !== '全部' && n.tag !== state.tag) return false
      if (!k) return true
      return n.title.includes(k) || n.excerpt.includes(k) || n.tag.includes(k)
    })
  })
  const pinned = computed(() => filtered.value.filter((n) => n.pinned))
  const rest = computed(() => filtered.value.filter((n) => !n.pinned))
  const tags = computed(() => {
    const t = ['全部']
    for (const n of state.notes) if (!t.includes(n.tag)) t.push(n.tag)
    return t
  })

  const icon = (c, size, cls) => h(c, { size, class: cls })
  const tagChip = (t) =>
    h('span', { class: 'rounded-full bg-bg-2 px-2 py-0.5 text-[11px] text-ink-2' }, t)

  function noteCard(n, extraCls = '') {
    return h(BaseCard, { key: n.id, class: `!p-4 ${extraCls}` }, () => [
      h('div', { class: 'flex items-start justify-between gap-2' }, [
        h('h3', { class: 'text-[15px] font-semibold' }, n.title),
        h('div', { class: 'flex shrink-0 items-center gap-1' }, [
          n.from_chat
            ? h('span', {
                class: 'flex items-center gap-1 rounded-full bg-brand-cyan/15 px-2 py-0.5 text-[10px] text-brand-cyan',
              }, [icon(MessageSquareText, 11), '来自对话'])
            : null,
          h('button', {
            type: 'button', 'aria-label': '置顶',
            class: `flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-micro active:scale-90 cursor-pointer ${n.pinned ? 'text-brand' : 'text-ink-2 hover:text-ink-0'}`,
            onClick: () => call('toggle_pin', { id: n.id }),
          }, icon(Pin, 14)),
          h('button', {
            type: 'button', 'aria-label': '删除',
            class: 'flex h-7 w-7 items-center justify-center rounded-lg text-ink-2 transition-all duration-micro hover:text-err active:scale-90 cursor-pointer',
            onClick: () => call('remove_note', { id: n.id }),
          }, icon(Trash2, 14)),
        ]),
      ]),
      h('p', { class: 'mt-1.5 line-clamp-2 text-sm leading-relaxed text-ink-1' }, n.excerpt),
      h('div', { class: 'mt-3 flex items-center gap-2 text-[11px] text-ink-2' }, [
        tagChip(n.tag), h('span', n.time),
      ]),
    ])
  }

  /** 左栏（标签过滤）——桌面竖排 / 手机横向 chips */
  const NotesPanel = defineComponent({
    name: 'NotesPanel',
    setup() {
      onMounted(refresh)
      return () =>
        layout.isMobile.value
          ? h('div', { class: 'flex gap-2' },
              tags.value.map((t) =>
                h('button', {
                  key: t, type: 'button',
                  class: `h-8 shrink-0 rounded-full px-3 text-[13px] transition-all duration-micro cursor-pointer ${
                    state.tag === t
                      ? 'bg-gradient-to-r from-brand to-brand-cyan text-white shadow-glow'
                      : 'bg-glass text-ink-1 border border-line'
                  }`,
                  onClick: () => (state.tag = t),
                }, t),
              ),
            )
          : h('div', { class: 'flex flex-col gap-1' },
              tags.value.map((t) =>
                h('button', {
                  key: t, type: 'button',
                  class: `flex items-center justify-between rounded-xl px-3 py-2 text-sm transition-all duration-micro cursor-pointer ${
                    state.tag === t ? 'bg-brand/15 text-brand' : 'text-ink-1 hover:bg-glass'
                  }`,
                  onClick: () => (state.tag = t),
                }, [
                  h('span', t),
                  h('span', { class: 'text-[11px] text-ink-2' },
                    t === '全部'
                      ? state.notes.length
                      : state.notes.filter((n) => n.tag === t).length),
                ]),
              ),
            )
    },
  })

  const NotesPage = defineComponent({
    name: 'NotesPage',
    setup() {
      onMounted(refresh)
      return () =>
        h('div', { class: 'flex h-full gap-3 p-3' }, [
          layout.isMobile.value
            ? null
            : h('aside', { class: 'w-56 shrink-0' },
                h(BasePanel, { title: '标签' }, () => [h(NotesPanel)])),
          h('div', { class: 'min-w-0 flex-1 overflow-y-auto' },
            h('div', { class: 'mx-auto flex w-full max-w-2xl flex-col gap-4 px-1 pb-4' }, [
              h('header', { class: 'flex items-end justify-between pt-1' }, [
                h('div', [
                  h('h1', { class: 'text-[30px] font-bold tracking-tight' }, '笔记'),
                  h('p', { class: 'mt-1 text-sm text-ink-2' }, 'M5 起，对话产出可一键保存到这里'),
                ]),
                h('button', {
                  type: 'button', 'aria-label': '新建笔记',
                  class: 'flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-r from-brand to-brand-cyan text-white shadow-glow transition-all duration-micro hover:brightness-110 active:scale-90 cursor-pointer',
                  onClick: async () => {
                    await call('add_note', { title: '未命名笔记', excerpt: '在这里记录想法……' })
                    toast.ok('已新建笔记')
                  },
                }, icon(Plus, 19)),
              ]),
              layout.isMobile.value ? h(NotesPanel) : null,
              h('label', { class: 'glass-panel flex items-center gap-2 rounded-2xl px-3.5' }, [
                icon(Search, 16, 'text-ink-2'),
                h('input', {
                  type: 'search', placeholder: '搜索标题、内容或标签', value: state.keyword,
                  class: 'h-10 flex-1 bg-transparent text-sm text-ink-0 placeholder:text-ink-2 border-0 outline-none shadow-none focus:ring-0',
                  onInput: (e) => (state.keyword = e.target.value),
                }),
              ]),
              state.loaded && state.notes.length === 0
                ? h(BaseCard, { class: 'border-dashed !p-6 text-center text-sm text-ink-2' },
                    () => '还没有笔记，点右上角 + 新建一条')
                : null,
              pinned.value.length
                ? h('section', { class: 'space-y-2' }, [
                    h('p', { class: 'px-1 text-xs font-medium text-ink-2' }, '已置顶'),
                    h('div', { class: 'stagger space-y-2' },
                      pinned.value.map((n) => noteCard(n, 'border-brand/25'))),
                  ])
                : null,
              h('section', { class: 'space-y-2' }, [
                h('p', { class: 'px-1 text-xs font-medium text-ink-2' },
                  `全部笔记 · ${rest.value.length}`),
                h('div', { class: 'stagger space-y-2' }, rest.value.map((n) => noteCard(n))),
              ]),
            ]),
          ),
        ])
    },
  })

  uiCtx.registerApp({
    id: 'notes', title: '笔记', icon: 'notebook-pen',
    route: '/notes', order: 10, component: NotesPage,
  })
}
