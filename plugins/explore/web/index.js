/**
 * explore 插件前端入口（无构建器：一切依赖由 uiCtx 注入）
 * M7：主界面自绘左栏（事件类型）或手机端退化为 chips
 */
export function setup(uiCtx) {
  const { vue, components, icons, api, layout } = uiCtx
  const { defineComponent, h, reactive, computed, onMounted } = vue
  const { BaseCard, BasePanel } = components
  const { Blocks, Wrench, MessageSquare } = icons

  const state = reactive({ feed: [], kind: 'all', loaded: false })

  async function refresh() {
    const data = await api.getAppState('explore')
    state.feed = data.feed || []
    state.loaded = true
  }

  const kinds = [
    { id: 'all', label: '全部' },
    { id: 'plugin', label: '插件' },
    { id: 'tool', label: '工具' },
    { id: 'chat', label: '对话' },
  ]
  const iconOf = { plugin: Blocks, tool: Wrench, chat: MessageSquare }
  const colorOf = {
    plugin: 'bg-brand/15 text-brand',
    tool: 'bg-warn/15 text-warn',
    chat: 'bg-brand-cyan/15 text-brand-cyan',
  }

  const filtered = computed(() =>
    state.kind === 'all' ? state.feed : state.feed.filter((f) => f.kind === state.kind),
  )
  const countOf = (k) =>
    k === 'all' ? state.feed.length : state.feed.filter((f) => f.kind === k).length

  const ExplorePanel = defineComponent({
    name: 'ExplorePanel',
    setup() {
      onMounted(refresh)
      return () =>
        layout.isMobile.value
          ? h('div', { class: 'flex gap-2' },
              kinds.map((k) =>
                h('button', {
                  key: k.id, type: 'button',
                  class: `h-8 shrink-0 rounded-full px-3 text-[13px] transition-all duration-micro cursor-pointer ${
                    state.kind === k.id
                      ? 'bg-gradient-to-r from-brand to-brand-cyan text-white shadow-glow'
                      : 'bg-glass text-ink-1 border border-line'
                  }`,
                  onClick: () => (state.kind = k.id),
                }, k.label),
              ),
            )
          : h('div', { class: 'flex flex-col gap-1' },
              kinds.map((k) =>
                h('button', {
                  key: k.id, type: 'button',
                  class: `flex items-center justify-between rounded-xl px-3 py-2 text-sm transition-all duration-micro cursor-pointer ${
                    state.kind === k.id ? 'bg-brand/15 text-brand' : 'text-ink-1 hover:bg-glass'
                  }`,
                  onClick: () => (state.kind = k.id),
                }, [
                  h('span', k.label),
                  h('span', { class: 'text-[11px] text-ink-2' }, countOf(k.id)),
                ]),
              ),
            )
    },
  })

  const ExplorePage = defineComponent({
    name: 'ExplorePage',
    setup() {
      onMounted(refresh)
      return () =>
        h('div', { class: 'flex h-full gap-3 p-3' }, [
          layout.isMobile.value
            ? null
            : h('aside', { class: 'w-56 shrink-0' },
                h(BasePanel, { title: '事件类型' }, () => [h(ExplorePanel)])),
          h('div', { class: 'min-w-0 flex-1 overflow-y-auto' },
            h('div', { class: 'mx-auto flex w-full max-w-2xl flex-col gap-4 px-1 pb-4' }, [
              h('header', { class: 'pt-1' }, [
                h('h1', { class: 'text-[30px] font-bold tracking-tight' }, '探索'),
                h('p', { class: 'mt-1 text-sm text-ink-2' }, 'Agent 内部动态流——事件分发的时间线'),
              ]),
              layout.isMobile.value ? h(ExplorePanel) : null,
              h('div', { class: 'grid grid-cols-3 gap-2' },
                [
                  ['插件事件', countOf('plugin')],
                  ['工具事件', countOf('tool')],
                  ['对话事件', countOf('chat')],
                ].map(([label, n]) =>
                  h(BaseCard, { key: label, class: '!p-3 text-center' }, () => [
                    h('p', { class: 'text-xl font-bold text-gradient' }, String(n)),
                    h('p', { class: 'mt-0.5 text-[11px] text-ink-2' }, label),
                  ]),
                ),
              ),
              h('section', { class: 'stagger space-y-2' },
                filtered.value.map((f) =>
                  h(BaseCard, { key: f.id, class: 'flex gap-3 !p-3.5' }, () => [
                    h('span', {
                      class: `flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${colorOf[f.kind] || colorOf.plugin}`,
                    }, [h(iconOf[f.kind] || Blocks, { size: 16 })]),
                    h('div', { class: 'min-w-0 flex-1' }, [
                      h('div', { class: 'flex items-baseline justify-between gap-2' }, [
                        h('h3', { class: 'truncate text-sm font-semibold' }, f.title),
                        h('span', { class: 'shrink-0 font-mono text-[10px] text-ink-2' }, f.time),
                      ]),
                      h('p', { class: 'mt-1 text-[13px] leading-relaxed text-ink-1' }, f.detail),
                    ]),
                  ]),
                ),
              ),
              state.loaded && filtered.value.length === 0
                ? h(BaseCard, { class: 'border-dashed !p-6 text-center text-sm text-ink-2' },
                    () => '该分类下还没有事件')
                : null,
            ]),
          ),
        ])
    },
  })

  uiCtx.registerApp({
    id: 'explore', title: '探索', icon: 'compass',
    route: '/explore', order: 20, component: ExplorePage,
  })
}
