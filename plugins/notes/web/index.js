/**
 * notes 插件前端入口（无构建器：不 import 任何 npm 包）
 * 依赖由内核经 uiCtx 注入：vue / components / icons / api / layout
 * M10.3：手机端紧凑行 + 左滑操作 + 删除撤销 + 筛选吸顶；桌面保持卡片流
 */
export function setup(uiCtx) {
  const { vue, components, icons, api, toast, layout } = uiCtx
  const { defineComponent, h, reactive, computed, onMounted } = vue
  const { BaseCard, BasePanel } = components
  const { Pin, Plus, Search, Trash2, MessageSquareText } = icons

  const isMobile = layout.isMobile
  const state = reactive({
    notes: [], keyword: '', tag: '全部', loaded: false,
    swipe: {},                        // 手机行左滑偏移 { [noteId]: x }
    undo: null,                       // { note } 删除待撤销
  })

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
    h('span', { class: 'rounded-full bg-bg-2 px-1.5 py-0.5 text-[10px] text-ink-2' }, t)
  const fromChat = () =>
    h('span', { class: 'flex items-center gap-1 text-brand-cyan' }, [icon(MessageSquareText, 10), '对话'])
  const isPlaceholder = (n) => !n.title || n.title === '未命名笔记'

  // ─── 删除 + 撤销（代替确认弹窗）────────────────────────
  let undoTimer = null
  async function removeNote(n) {
    await call('remove_note', { id: n.id })
    clearTimeout(undoTimer)
    state.undo = { note: n }
    undoTimer = setTimeout(() => (state.undo = null), 5000)
  }
  async function undoDelete() {
    const n = state.undo.note
    state.undo = null
    clearTimeout(undoTimer)
    await call('add_note', { title: n.title, excerpt: n.excerpt, tag: n.tag })
    toast.ok('已恢复笔记')
  }
  const undoBar = () => state.undo && h('div', {
    class: 'glass-panel fixed inset-x-4 z-50 flex items-center justify-between rounded-2xl px-4 py-2.5 text-sm shadow-card',
    style: 'bottom: 84px',
  }, [
    h('span', { class: 'truncate text-ink-1' }, `已删除「${state.undo.note.title}」`),
    h('button', {
      type: 'button',
      class: 'shrink-0 font-medium text-brand cursor-pointer',
      onClick: undoDelete,
    }, '撤销'),
  ])

  // ─── 手机左滑：露出 置顶 / 删除 ────────────────────────
  const SWIPE_W = 116
  const touch = { id: null, x: 0, y: 0, axis: '', base: 0 }

  function onTS(n, e) {
    const t = e.touches[0]
    touch.id = n.id; touch.x = t.clientX; touch.y = t.clientY
    touch.axis = ''; touch.base = state.swipe[n.id] || 0
  }
  function onTM(n, e) {
    if (touch.id !== n.id) return
    const t = e.touches[0]
    const dx = t.clientX - touch.x, dy = t.clientY - touch.y
    if (!touch.axis) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
      touch.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    }
    if (touch.axis !== 'x') return          // 纵向滚动不受影响
    e.preventDefault()
    let x = touch.base + dx
    if (x > 0) x = 0
    if (x < -SWIPE_W - 12) x = -SWIPE_W - 12
    state.swipe[n.id] = x
  }
  function onTE(n) {
    if (touch.id !== n.id) return
    const x = state.swipe[n.id] || 0
    state.swipe[n.id] = x < -SWIPE_W / 2 ? -SWIPE_W : 0
    touch.id = null
  }
  const closeSwipe = (n) => (state.swipe[n.id] = 0)

  /** 手机紧凑行（约 64px）：标题 + 一行摘要 + 标签·时间；左滑出操作 */
  function noteRow(n) {
    const off = state.swipe[n.id] || 0
    const dragging = touch.id === n.id && touch.axis === 'x'
    return h('div', { key: n.id, class: 'relative overflow-hidden rounded-2xl' }, [
      // 底层操作键
      h('div', { class: 'absolute inset-y-0 right-0 flex gap-1' }, [
        h('button', {
          type: 'button', 'aria-label': '置顶',
          class: 'flex w-14 items-center justify-center bg-amber-400/95 text-bg-0 cursor-pointer',
          onClick: async () => { await call('toggle_pin', { id: n.id }); closeSwipe(n) },
        }, icon(Pin, 16)),
        h('button', {
          type: 'button', 'aria-label': '删除',
          class: 'flex w-14 items-center justify-center rounded-r-2xl bg-err text-white cursor-pointer',
          onClick: () => { removeNote(n); closeSwipe(n) },
        }, icon(Trash2, 16)),
      ]),
      // 前景行
      h('div', {
        class: 'relative cursor-pointer rounded-2xl border border-line bg-bg-1 px-3.5 py-2.5 active:scale-[0.99]',
        style: `transform: translateX(${off}px);${dragging ? '' : 'transition: transform 200ms'}`,
        onTouchstart: (e) => onTS(n, e),
        onTouchmove: (e) => onTM(n, e),
        onTouchend: () => onTE(n),
      }, [
        h('div', { class: 'flex items-center gap-1.5' }, [
          n.pinned ? icon(Pin, 12, 'shrink-0 text-brand') : null,
          h('span', {
            class: `truncate text-[14px] font-medium ${isPlaceholder(n) ? 'text-ink-2 italic' : ''}`,
          }, n.title),
        ]),
        h('p', { class: 'mt-0.5 truncate text-[12px] text-ink-2' }, n.excerpt),
        h('div', { class: 'mt-1.5 flex items-center gap-2 text-[10px] text-ink-2' }, [
          tagChip(n.tag), h('span', n.time), n.from_chat ? fromChat() : null,
        ]),
      ]),
    ])
  }

  /** 桌面卡片（保留 hover 操作图标）*/
  function noteCard(n, extraCls = '') {
    return h(BaseCard, { key: n.id, class: `!p-4 ${extraCls}` }, () => [
      h('div', { class: 'flex items-start justify-between gap-2' }, [
        h('h3', { class: 'text-[15px] font-semibold' }, n.title),
        h('div', { class: 'flex shrink-0 items-center gap-1' }, [
          n.from_chat ? h('span', {
            class: 'flex items-center gap-1 rounded-full bg-brand-cyan/15 px-2 py-0.5 text-[10px] text-brand-cyan',
          }, [icon(MessageSquareText, 11), '来自对话']) : null,
          h('button', {
            type: 'button', 'aria-label': '置顶',
            class: `flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-micro active:scale-90 cursor-pointer ${n.pinned ? 'text-brand' : 'text-ink-2 hover:text-ink-0'}`,
            onClick: () => call('toggle_pin', { id: n.id }),
          }, icon(Pin, 14)),
          h('button', {
            type: 'button', 'aria-label': '删除',
            class: 'flex h-7 w-7 items-center justify-center rounded-lg text-ink-2 transition-all duration-micro hover:text-err active:scale-90 cursor-pointer',
            onClick: () => removeNote(n),
          }, icon(Trash2, 14)),
        ]),
      ]),
      h('p', { class: 'mt-1.5 line-clamp-2 text-sm leading-relaxed text-ink-1' }, n.excerpt),
      h('div', { class: 'mt-3 flex items-center gap-2 text-[11px] text-ink-2' }, [
        tagChip(n.tag), h('span', n.time),
      ]),
    ])
  }

  /** 左栏（标签过滤）——桌面竖排 / 手机横向 chips（放进吸顶筛选条）*/
  const NotesPanel = defineComponent({
    name: 'NotesPanel',
    setup() {
      onMounted(refresh)
      return () =>
        isMobile.value
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
                    t === '全部' ? state.notes.length
                                 : state.notes.filter((n) => n.tag === t).length),
                ]),
              ),
            )
    },
  })

  const searchBox = () =>
    h('label', { class: 'glass-panel flex items-center gap-2 rounded-2xl px-3.5' }, [
      icon(Search, 16, 'text-ink-2'),
      h('input', {
        type: 'search', placeholder: '搜索标题、内容或标签', value: state.keyword,
        class: 'h-10 flex-1 bg-transparent text-sm text-ink-0 placeholder:text-ink-2 border-0 outline-none shadow-none focus:ring-0',
        onInput: (e) => (state.keyword = e.target.value),
      }),
    ])

  const newNoteBtn = () =>
    h('button', {
      type: 'button', 'aria-label': '新建笔记',
      class: 'flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-r from-brand to-brand-cyan text-white shadow-glow transition-all duration-micro hover:brightness-110 active:scale-90 cursor-pointer',
      onClick: async () => {
        await call('add_note', { title: '未命名笔记', excerpt: '在这里记录想法……' })
        toast.ok('已新建笔记')
      },
    }, icon(Plus, 19))

  const emptyHint = () =>
    state.loaded && filtered.value.length === 0
      ? h(BaseCard, { class: 'border-dashed !p-6 text-center text-sm text-ink-2' },
          () => state.notes.length ? '没有匹配的笔记，换个关键词试试' : '还没有笔记，点右上角 + 新建一条')
      : null

  const NotesPage = defineComponent({
    name: 'NotesPage',
    setup() {
      onMounted(refresh)
      return () => {
        // ─── 手机：紧凑行流 + 吸顶筛选 ───
        if (isMobile.value) {
          return h('div', { class: 'flex h-full flex-col' }, [
            h('header', { class: 'flex items-end justify-between px-1 pt-1' }, [
              h('div', [
                h('h1', { class: 'text-[30px] font-bold tracking-tight' }, '笔记'),
                h('p', { class: 'mt-0.5 text-sm text-ink-2' }, `${state.notes.length} 条 · 对话产出可保存到这里`),
              ]),
              newNoteBtn(),
            ]),
            // 滚动时吸顶的筛选条：搜索 + 标签 chips
            h('div', { class: 'sticky top-14 z-20 -mx-1 mt-2 bg-bg-0/85 px-1 py-2 backdrop-blur' }, [
              searchBox(),
              h('div', { class: 'mt-2 overflow-x-auto dock-scroll' }, [h(NotesPanel)]),
            ]),
            h('div', { class: 'stagger space-y-1.5 pt-1' }, filtered.value.map((n) => noteRow(n))),
            emptyHint(),
            undoBar(),
          ])
        }
        // ─── 桌面：左栏 + 卡片流 ───
        return h('div', { class: 'flex h-full gap-3 p-3' }, [
          h('aside', { class: 'w-56 shrink-0' },
            h(BasePanel, { title: '标签' }, () => [h(NotesPanel)])),
          h('div', { class: 'min-w-0 flex-1 overflow-y-auto' },
            h('div', { class: 'mx-auto flex w-full max-w-2xl flex-col gap-3 px-1 pb-4' }, [
              h('header', { class: 'flex items-end justify-between pt-1' }, [
                h('div', [
                  h('h1', { class: 'text-[30px] font-bold tracking-tight' }, '笔记'),
                  h('p', { class: 'mt-1 text-sm text-ink-2' }, '对话产出可一键保存到这里'),
                ]),
                newNoteBtn(),
              ]),
              searchBox(),
              pinned.value.length
                ? h('section', { class: 'space-y-2' }, [
                    h('p', { class: 'px-1 text-xs font-medium text-ink-2' }, '已置顶'),
                    h('div', { class: 'stagger space-y-2' },
                      pinned.value.map((n) => noteCard(n, 'border-brand/25'))),
                  ])
                : null,
              h('section', { class: 'space-y-2' }, [
                h('p', { class: 'px-1 text-xs font-medium text-ink-2' }, `全部笔记 · ${rest.value.length}`),
                h('div', { class: 'stagger space-y-2' }, rest.value.map((n) => noteCard(n))),
              ]),
              emptyHint(),
              undoBar(),
            ]),
          ),
        ])
      }
    },
  })

  uiCtx.registerApp({
    id: 'notes', title: '笔记', icon: 'notebook-pen',
    route: '/notes', order: 10, component: NotesPage,
  })
}
