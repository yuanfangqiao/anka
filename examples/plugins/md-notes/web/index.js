/** Markdown 记事本 —— 纯前端插件，数据存 localStorage（无任何 npm 依赖）
 *  响应式：≥820px 左右分栏；<820px 单栏「列表 ⇄ 编辑」，触控友好 */
export function setup(uiCtx) {
  const { vue, toast } = uiCtx
  const api = uiCtx.api || {}
  const { defineComponent, h, ref, computed, watch, onMounted } = vue
  const onUnmounted = typeof vue.onUnmounted === 'function' ? vue.onUnmounted : () => {}

  const STORAGE_KEY = 'md-notes:v1'
  const STYLE_ID = 'md-notes-style'

  /* ---------------- 小工具 ---------------- */
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function pad(n) {
    return String(n).padStart(2, '0')
  }

  function formatTime(ts) {
    const d = new Date(ts || Date.now())
    const now = new Date()
    if (d.toDateString() === now.toDateString()) return pad(d.getHours()) + ':' + pad(d.getMinutes())
    return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
  }

  function uid() {
    return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
  }

  function countWords(text) {
    const t = String(text || '').trim()
    if (!t) return 0
    const cn = (t.match(/[\u4e00-\u9fa5]/g) || []).length
    const en = (t.replace(/[\u4e00-\u9fa5]/g, ' ').match(/[A-Za-z0-9_'-]+/g) || []).length
    return cn + en
  }

  function plainPreview(src) {
    return String(src || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[#>*`|_\-\[\]()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  /* ---------------- 迷你 Markdown 渲染器 ---------------- */
  function inline(s) {
    let t = esc(s)
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>')
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    t = t.replace(/~~([^~]+)~~/g, '<del>$1</del>')
    t = t.replace(
      /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    )
    return t
  }

  function mdToHtml(src) {
    const lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n')
    const out = []
    let i = 0
    let listType = null
    const closeList = () => {
      if (listType) {
        out.push('</' + listType + '>')
        listType = null
      }
    }

    while (i < lines.length) {
      const line = lines[i]

      const fence = line.match(/^\s*```(.*)$/)
      if (fence) {
        closeList()
        const lang = fence[1].trim()
        const buf = []
        i++
        while (i < lines.length && !/^\s*```/.test(lines[i])) {
          buf.push(lines[i])
          i++
        }
        i++
        out.push(
          '<pre' + (lang ? ' data-lang="' + esc(lang) + '"' : '') + '><code>' + esc(buf.join('\n')) + '</code></pre>'
        )
        continue
      }

      if (!line.trim()) {
        closeList()
        i++
        continue
      }

      const hm = line.match(/^(#{1,6})\s+(.*)$/)
      if (hm) {
        closeList()
        const lv = hm[1].length
        out.push('<h' + lv + '>' + inline(hm[2].replace(/\s+#+\s*$/, '')) + '</h' + lv + '>')
        i++
        continue
      }

      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
        closeList()
        out.push('<hr/>')
        i++
        continue
      }

      if (/^\s*>\s?/.test(line)) {
        closeList()
        const buf = []
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*>\s?/, ''))
          i++
        }
        out.push('<blockquote>' + mdToHtml(buf.join('\n')) + '</blockquote>')
        continue
      }

      if (
        line.indexOf('|') !== -1 &&
        i + 1 < lines.length &&
        /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1]) &&
        lines[i + 1].indexOf('-') !== -1
      ) {
        closeList()
        const cells = (l) =>
          l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((x) => x.trim())
        const head = cells(line)
        i += 2
        const rows = []
        while (i < lines.length && lines[i].trim() && lines[i].indexOf('|') !== -1) {
          rows.push(cells(lines[i]))
          i++
        }
        out.push(
          '<table><thead><tr>' +
            head.map((c) => '<th>' + inline(c) + '</th>').join('') +
            '</tr></thead><tbody>' +
            rows
              .map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>')
              .join('') +
            '</tbody></table>'
        )
        continue
      }

      const lm = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/)
      if (lm) {
        const type = /\d/.test(lm[2]) ? 'ol' : 'ul'
        if (listType !== type) {
          closeList()
          out.push('<' + type + '>')
          listType = type
        }
        out.push('<li>' + inline(lm[3]) + '</li>')
        i++
        continue
      }

      closeList()
      const buf = [line]
      i++
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^\s*(#{1,6}\s|>|```|[-*+]\s|\d+[.)]\s)/.test(lines[i])
      ) {
        buf.push(lines[i])
        i++
      }
      out.push('<p>' + buf.map(inline).join('<br/>') + '</p>')
    }
    closeList()
    return out.join('\n')
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return
    const el = document.createElement('style')
    el.id = STYLE_ID
    el.textContent = `
.md-notes-wrap * { -webkit-tap-highlight-color: transparent; }
.md-notes-wrap { overscroll-behavior: contain; }

.md-notes-body { font-size: 13.5px; line-height: 1.75; word-break: break-word; }
.md-notes-body > *:first-child { margin-top: 0; }
.md-notes-body h1 { font-size: 1.6em; font-weight: 700; margin: .7em 0 .4em; }
.md-notes-body h2 { font-size: 1.35em; font-weight: 700; margin: .7em 0 .4em; }
.md-notes-body h3 { font-size: 1.15em; font-weight: 600; margin: .6em 0 .35em; }
.md-notes-body h4, .md-notes-body h5, .md-notes-body h6 { font-size: 1em; font-weight: 600; margin: .5em 0 .3em; }
.md-notes-body p { margin: .45em 0; }
.md-notes-body code { background: rgba(127,127,127,.18); padding: .12em .35em; border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .92em; }
.md-notes-body pre { background: rgba(127,127,127,.12); padding: 10px 12px; border-radius: 8px;
  overflow: auto; margin: .5em 0; -webkit-overflow-scrolling: touch; }
.md-notes-body pre code { background: none; padding: 0; }
.md-notes-body ul { list-style: disc; padding-left: 1.4em; margin: .4em 0; }
.md-notes-body ol { list-style: decimal; padding-left: 1.4em; margin: .4em 0; }
.md-notes-body li { margin: .15em 0; }
.md-notes-body blockquote { border-left: 3px solid rgba(127,127,127,.45); padding-left: 10px;
  margin: .5em 0; opacity: .85; }
.md-notes-body a { text-decoration: underline; }
.md-notes-body hr { border: none; border-top: 1px solid rgba(127,127,127,.3); margin: 1em 0; }
.md-notes-body table { border-collapse: collapse; margin: .5em 0; font-size: .95em;
  display: block; overflow-x: auto; max-width: 100%; }
.md-notes-body th, .md-notes-body td { border: 1px solid rgba(127,127,127,.3); padding: 4px 8px;
  white-space: nowrap; }
.md-notes-body th { font-weight: 600; background: rgba(127,127,127,.08); }
.md-notes-body img { max-width: 100%; border-radius: 6px; }

.md-notes-wrap div::-webkit-scrollbar { width: 8px; height: 8px; }
.md-notes-wrap div::-webkit-scrollbar-thumb { background: rgba(127,127,127,.28); border-radius: 4px; }
.md-notes-wrap div::-webkit-scrollbar-track { background: transparent; }
`
    document.head.appendChild(el)
  }

  const WELCOME = [
    '## 欢迎使用 Markdown 记事本',
    '',
    '这是一款**纯本地**的 Markdown 笔记应用，内容保存在浏览器 localStorage 中，刷新不会丢失。',
    '',
    '- 电脑端：左侧列表 + 右侧编辑/预览分栏',
    '- 手机端：列表页与编辑页单栏切换，点笔记进入，点「←」返回',
    '- 输入即自动保存，按 `Tab` 插入缩进',
    '',
    '> 支持标题、列表、引用、代码块与表格。',
    '',
    '```js',
    "const hello = 'world'",
    '```',
    '',
    '| 功能 | 说明 |',
    '| --- | --- |',
    '| 分栏 | 左边写，右边实时看 |',
    '',
    '---',
    '',
    '现在就把这段文字改成你自己的内容吧。',
  ].join('\n')

  const BORDER = '1px solid rgba(127,127,127,.22)'
  const BG_SOFT = 'rgba(127,127,127,.04)'
  const BG_ACTIVE = 'rgba(127,127,127,.14)'

  const NOTE_STYLE = { border: BORDER, borderRadius: '12px', background: BG_SOFT }

  /* ---------------- 组件 ---------------- */
  const Page = defineComponent({
    name: 'MdNotes',
    setup() {
      const notes = ref([])
      const activeId = ref(null)
      const mode = ref('split') // 桌面：edit | split | preview
      const query = ref('')
      const noteInput = ref('')
      const viewport = ref(typeof window !== 'undefined' ? window.innerWidth : 1280)
      const mobilePane = ref('list') // 移动端：list | editor
      const listScroll = ref(0)

      const isMobile = computed(() => viewport.value < 820)

      const activeNote = computed(() => notes.value.find((n) => n.id === activeId.value) || null)

      const filtered = computed(() => {
        const q = query.value.trim().toLowerCase()
        const list = q
          ? notes.value.filter(
              (n) =>
                (n.title || '').toLowerCase().indexOf(q) !== -1 ||
                (n.content || '').toLowerCase().indexOf(q) !== -1
            )
          : notes.value.slice()
        return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      })

      const html = computed(() => (activeNote.value ? mdToHtml(activeNote.value.content) : ''))

      function persist() {
        try {
          localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ notes: notes.value, activeId: activeId.value })
          )
        } catch (e) {
          /* 忽略存储异常 */
        }
      }

      function load() {
        let loaded = null
        try {
          const raw = localStorage.getItem(STORAGE_KEY)
          if (raw) loaded = JSON.parse(raw)
        } catch (e) {
          loaded = null
        }
        if (loaded && Array.isArray(loaded.notes) && loaded.notes.length) {
          notes.value = loaded.notes.map((n) => ({
            id: n.id || uid(),
            title: n.title || '',
            content: n.content || '',
            updatedAt: n.updatedAt || Date.now(),
          }))
          activeId.value =
            loaded.activeId && notes.value.some((n) => n.id === loaded.activeId)
              ? loaded.activeId
              : notes.value[0].id
        } else {
          const n = { id: uid(), title: '欢迎使用 Markdown 记事本', content: WELCOME, updatedAt: Date.now() }
          notes.value = [n]
          activeId.value = n.id
          persist()
        }
      }

      function createNote() {
        const n = { id: uid(), title: '', content: '', updatedAt: Date.now() }
        notes.value.unshift(n)
        activeId.value = n.id
        noteInput.value = ''
        if (mobilePane.value !== undefined) mobilePane.value = 'editor'
        if (mode.value === 'preview') mode.value = 'edit'
      }

      function openNote(n) {
        activeId.value = n.id
        if (isMobile.value) mobilePane.value = 'editor'
      }

      function removeNote(note) {
        const target = note || activeNote.value
        if (!target) return
        if (!window.confirm('删除笔记「' + (target.title || '未命名') + '」？此操作不可撤销。')) return
        const idx = notes.value.findIndex((n) => n.id === target.id)
        if (idx === -1) return
        notes.value.splice(idx, 1)
        if (activeId.value === target.id) {
          const next = notes.value[Math.min(idx, notes.value.length - 1)]
          activeId.value = next ? next.id : null
          noteInput.value = next ? next.content : ''
          if (isMobile.value && !next) mobilePane.value = 'list'
        }
      }

      function touch(patch) {
        const note = activeNote.value
        if (!note) return
        Object.assign(note, patch, { updatedAt: Date.now() })
      }

      function copyMarkdown() {
        const note = activeNote.value
        if (!note) return
        const text = note.content || ''
        const done = () => {
          try {
            if (toast && typeof toast.success === 'function') toast.success('已复制 Markdown 源码')
            else if (toast && typeof toast === 'function') toast('已复制 Markdown 源码')
          } catch (e) {
            /* 忽略 */
          }
        }
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, done)
          } else {
            done()
          }
        } catch (e) {
          done()
        }
      }

      function onKeydown(e) {
        if (e.key === 'Tab') {
          e.preventDefault()
          const el = e.target
          const start = el.selectionStart
          const end = el.selectionEnd
          const value = el.value
          noteInput.value = value.slice(0, start) + '  ' + value.slice(end)
          touch({ content: noteInput.value })
          vue.nextTick(() => {
            try {
              el.selectionStart = el.selectionEnd = start + 2
            } catch (err) {
              /* 忽略 */
            }
          })
        }
      }

      function onResize() {
        viewport.value = window.innerWidth
      }

      function onPopState() {
        if (isMobile.value && mobilePane.value === 'editor') mobilePane.value = 'list'
      }

      watch(activeId, () => {
        noteInput.value = activeNote.value ? activeNote.value.content : ''
      })
      watch(notes, persist, { deep: true })
      watch(activeId, persist)
      watch(isMobile, (m) => {
        if (m) mobilePane.value = activeId.value ? 'list' : 'list'
        else mobilePane.value = 'list'
      })

      onMounted(() => {
        injectStyle()
        load()
        noteInput.value = activeNote.value ? activeNote.value.content : ''
        window.addEventListener('resize', onResize)
        window.addEventListener('orientationchange', onResize)
        window.addEventListener('popstate', onPopState)
      })
      onUnmounted(() => {
        window.removeEventListener('resize', onResize)
        window.removeEventListener('orientationchange', onResize)
        window.removeEventListener('popstate', onPopState)
      })

      /* ---------------- 渲染辅助 ---------------- */
      function btn(label, onClick, active, title, big) {
        return h(
          'button',
          {
            class:
              'rounded-lg transition select-none ' +
              (big ? 'px-3 py-2 text-[13px]' : 'px-2.5 py-1 text-[12px]'),
            style: {
              border: '1px solid rgba(127,127,127,.3)',
              background: active ? 'rgba(127,127,127,.22)' : 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              minHeight: big ? '38px' : 'auto',
              touchAction: 'manipulation',
            },
            title: title || label,
            onClick,
          },
          label
        )
      }

      function inputStyle(extra) {
        return Object.assign({ color: 'inherit', border: BORDER, borderRadius: '10px', background: BG_SOFT }, extra)
      }

      const panelStyle = Object.assign({ overflow: 'auto', minHeight: '0' }, NOTE_STYLE)

      const textareaStyle = (size) => ({
        color: 'inherit',
        border: 'none',
        background: 'transparent',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: size + 'px',
        lineHeight: '1.7',
      })

      /* ---------------- 笔记列表项 ---------------- */
      function noteRow(n, big) {
        const active = n.id === activeId.value
        return h(
          'div',
          {
            key: n.id,
            class: 'cursor-pointer transition',
            style: {
              padding: big ? '12px 14px' : '9px 10px',
              borderRadius: '11px',
              border: '1px solid ' + (active ? 'rgba(127,127,127,.45)' : 'transparent'),
              background: active ? BG_ACTIVE : BG_SOFT,
              touchAction: 'manipulation',
            },
            onClick: () => openNote(n),
          },
          [
            h(
              'div',
              {
                class: 'truncate font-medium',
                style: { fontSize: big ? '15px' : '13px' },
              },
              n.title || '未命名笔记'
            ),
            h(
              'div',
              { class: 'truncate opacity-55', style: { fontSize: big ? '12.5px' : '11px', marginTop: '2px' } },
              plainPreview(n.content).slice(0, big ? 80 : 60) || '空笔记'
            ),
            h(
              'div',
              { class: 'opacity-40', style: { fontSize: '10.5px', marginTop: '3px' } },
              formatTime(n.updatedAt) + ' · ' + countWords(n.content) + ' 词'
            ),
          ]
        )
      }

      function searchBox(big) {
        return h('input', {
          value: query.value,
          placeholder: '搜索标题或内容…',
          onInput: (e) => {
            query.value = e.target.value
          },
          class: 'w-full outline-none',
          style: inputStyle({
            padding: big ? '10px 12px' : '6px 10px',
            fontSize: (big ? 16 : 12) + 'px',
          }),
        })
      }

      /* ---------------- 移动端：笔记列表页 ---------------- */
      function mobileList() {
        return h('div', { class: 'flex h-full min-h-0 flex-col gap-2.5 p-3' }, [
          h('div', { class: 'flex items-center gap-2' }, [
            h('div', { class: 'flex-1 text-[17px] font-semibold tracking-tight' }, 'Markdown 记事本'),
            h('div', { class: 'text-[11px] opacity-50' }, notes.value.length + ' 篇笔记'),
          ]),
          searchBox(true),
          h(
            'button',
            {
              class: 'w-full rounded-xl font-medium',
              style: {
                border: '1px solid rgba(127,127,127,.35)',
                background: 'rgba(127,127,127,.12)',
                color: 'inherit',
                padding: '11px 12px',
                fontSize: '15px',
                touchAction: 'manipulation',
              },
              onClick: createNote,
            },
            '+ 新建笔记'
          ),
          h(
            'div',
            {
              class: 'flex min-h-0 flex-1 flex-col gap-2 overflow-auto',
              style: { WebkitOverflowScrolling: 'touch', paddingBottom: '12px' },
            },
            filtered.value.length
              ? filtered.value.map((n) => noteRow(n, true))
              : h('div', { class: 'p-4 text-center text-[13px] opacity-50' }, '没有匹配的笔记')
          ),
        ])
      }

      /* ---------------- 移动端：编辑页 ---------------- */
      function mobileEditor() {
        const note = activeNote.value
        const backBtn = h(
          'button',
          {
            class: 'flex shrink-0 items-center justify-center rounded-lg',
            style: {
              width: '40px',
              height: '40px',
              border: '1px solid rgba(127,127,127,.3)',
              background: 'transparent',
              color: 'inherit',
              fontSize: '18px',
              lineHeight: '1',
              touchAction: 'manipulation',
            },
            title: '返回列表',
            onClick: () => {
              mobilePane.value = 'list'
            },
          },
          '←'
        )

        if (!note) {
          return h('div', { class: 'flex h-full min-h-0 flex-col gap-3 p-3' }, [
            backBtn,
            h('div', { class: 'flex flex-1 items-center justify-center text-[14px] opacity-60' }, '笔记不存在'),
          ])
        }

        const showPreview = mode.value === 'preview'

        const body = showPreview
          ? h('div', { class: 'min-h-0 flex-1 overflow-auto', style: Object.assign({}, panelStyle, { borderRadius: '12px' }) }, [
              h('div', { class: 'md-notes-body p-3.5', innerHTML: html.value }),
            ])
          : h('div', { class: 'flex min-h-0 flex-1 flex-col overflow-hidden', style: Object.assign({}, panelStyle, { borderRadius: '12px' }) }, [
              h('textarea', {
                value: noteInput.value,
                placeholder: '在这里用 Markdown 书写…',
                spellcheck: 'false',
                onInput: (e) => {
                  noteInput.value = e.target.value
                  touch({ content: e.target.value })
                },
                onKeydown,
                class: 'h-full w-full flex-1 resize-none outline-none',
                style: Object.assign(textareaStyle(16), { padding: '12px 14px' }),
              }),
            ])

        return h('div', { class: 'flex h-full min-h-0 flex-col gap-2.5 p-3' }, [
          h('div', { class: 'flex items-center gap-2' }, [
            backBtn,
            h('input', {
              value: note.title,
              placeholder: '无标题',
              onInput: (e) => {
                touch({ title: e.target.value })
              },
              class: 'min-w-0 flex-1 font-semibold outline-none',
              style: inputStyle({ padding: '10px 12px', fontSize: '16px' }),
            }),
            h(
              'button',
              {
                class: 'shrink-0 rounded-lg',
                style: {
                  width: '40px',
                  height: '40px',
                  border: '1px solid rgba(127,127,127,.3)',
                  background: 'transparent',
                  color: 'inherit',
                  fontSize: '15px',
                  touchAction: 'manipulation',
                },
                title: '删除笔记',
                onClick: () => removeNote(note),
              },
              '🗑'
            ),
          ]),
          h('div', { class: 'flex items-center gap-2' }, [
            btn('编辑', () => (mode.value = 'edit'), !showPreview, '编辑模式', true),
            btn('预览', () => (mode.value = 'preview'), showPreview, '预览模式', true),
            btn('复制', copyMarkdown, false, '复制 Markdown 源码', true),
            h(
              'div',
              { class: 'ml-auto text-[11px] opacity-45' },
              countWords(note.content) + ' 词 · 自动保存'
            ),
          ]),
          body,
        ])
      }

      /* ---------------- 桌面端：列表侧栏 ---------------- */
      function sidebar() {
        return h('div', { class: 'flex w-[236px] shrink-0 flex-col gap-2' }, [
          h('div', { class: 'flex items-center gap-2' }, [
            h('div', { class: 'text-[14px] font-semibold' }, '全部笔记'),
            h('div', { class: 'text-[11px] opacity-50' }, '(' + notes.value.length + ')'),
            h('div', { class: 'ml-auto' }, btn('新建', createNote, false, '新建笔记')),
          ]),
          searchBox(false),
          h(
            'div',
            { class: 'flex min-h-0 flex-1 flex-col gap-1 overflow-auto pr-0.5' },
            filtered.value.length
              ? filtered.value.map((n) => noteRow(n, false))
              : h('div', { class: 'p-3 text-[12px] opacity-50' }, '没有匹配的笔记')
          ),
        ])
      }

      /* ---------------- 桌面端：主区域 ---------------- */
      function desktopMain() {
        const note = activeNote.value
        if (!note) {
          return h('div', { class: 'flex flex-1 flex-col items-center justify-center gap-3' }, [
            h('div', { class: 'text-[14px] opacity-60' }, '还没有选中笔记'),
            btn('新建一篇笔记', createNote),
          ])
        }
        const showEdit = mode.value !== 'preview'
        const showPrev = mode.value !== 'edit'

        const editor = h(
          'div',
          { class: 'flex min-h-0 flex-1 flex-col overflow-hidden', style: panelStyle },
          [
            h('textarea', {
              value: noteInput.value,
              placeholder: '在这里用 Markdown 书写…',
              spellcheck: 'false',
              onInput: (e) => {
                noteInput.value = e.target.value
                touch({ content: e.target.value })
              },
              onKeydown,
              class: 'h-full w-full flex-1 resize-none outline-none',
              style: Object.assign(textareaStyle(13), { padding: '12px' }),
            }),
          ]
        )

        const preview = h('div', { class: 'min-h-0 flex-1 overflow-auto', style: panelStyle }, [
          h('div', { class: 'md-notes-body p-3', innerHTML: html.value }),
        ])

        return h('div', { class: 'flex min-h-0 min-w-0 flex-1 flex-col gap-2' }, [
          h('div', { class: 'flex flex-wrap items-center gap-2' }, [
            h('input', {
              value: note.title,
              placeholder: '无标题',
              onInput: (e) => {
                touch({ title: e.target.value })
              },
              class: 'min-w-[120px] flex-1 font-semibold outline-none',
              style: inputStyle({ padding: '7px 10px', fontSize: '14px' }),
            }),
            btn('编辑', () => (mode.value = 'edit'), mode.value === 'edit', '仅编辑'),
            btn('分栏', () => (mode.value = 'split'), mode.value === 'split', '编辑 + 实时预览'),
            btn('预览', () => (mode.value = 'preview'), mode.value === 'preview', '仅预览'),
            btn('复制', copyMarkdown, false, '复制 Markdown 源码'),
            btn('删除', () => removeNote(note), false, '删除当前笔记'),
          ]),
          h(
            'div',
            { class: 'flex min-h-0 flex-1 gap-2' },
            [showEdit ? editor : null, showPrev ? preview : null].filter(Boolean)
          ),
        ])
      }

      /* ---------------- 顶层 ---------------- */
      return () =>
        h(
          'div',
          { class: 'md-notes-wrap flex h-full min-h-0 flex-col', style: { overflow: 'hidden' } },
          isMobile.value
            ? [mobilePane.value === 'editor' ? mobileEditor() : mobileList()]
            : [
                h('div', { class: 'flex items-baseline gap-2 px-3 pt-3' }, [
                  h('div', { class: 'text-[16px] font-semibold tracking-tight' }, 'Markdown 记事本'),
                  h(
                    'div',
                    { class: 'text-[11px] opacity-50' },
                    activeNote.value
                      ? countWords(activeNote.value.content) +
                          ' 词 · ' +
                          (activeNote.value.content || '').length +
                          ' 字符 · 自动保存到本地'
                      : '本地存储，无需联网'
                  ),
                ]),
                h('div', { class: 'flex min-h-0 flex-1 gap-3 p-3' }, [sidebar(), desktopMain()]),
              ]
        )
    },
  })

  uiCtx.registerApp({
    id: 'md-notes',
    title: 'Markdown 记事本',
    icon: 'notebook-pen',
    route: '/md-notes',
    order: 60,
    component: Page,
  })
}
