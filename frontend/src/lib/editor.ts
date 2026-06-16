import {
  type Editor,
  Extension,
  Node as TiptapNode,
  mergeAttributes,
} from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { Image } from '@tiptap/extension-image'
import { Markdown } from 'tiptap-markdown'
import Suggestion from '@tiptap/suggestion'
import { Plugin } from '@tiptap/pm/state'
import jspreadsheet from 'jspreadsheet-ce'

// ── Spreadsheet node ─────────────────────────────────────────────────────────

type CellValue = string | number | boolean | null
type GridData = CellValue[][]
type SheetState = { data: GridData; headers: string[] }

const DEFAULT_GRID: GridData = [
  ['', '', ''],
  ['', '', ''],
  ['', '', ''],
]

function defaultColumnName(i: number): string {
  let name = ''
  let n = i
  do {
    name = String.fromCharCode(65 + (n % 26)) + name
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return name
}

function isDefaultColumnName(header: string, i: number): boolean {
  return !header || header === defaultColumnName(i)
}

function parseGridJson(raw: string): SheetState {
  try {
    const obj = JSON.parse(raw)
    if (Array.isArray(obj)) return { data: obj as GridData, headers: [] }
    if (obj && Array.isArray(obj.data)) {
      return {
        data: obj.data as GridData,
        headers: Array.isArray(obj.headers) ? obj.headers : [],
      }
    }
  } catch {}
  return { data: DEFAULT_GRID, headers: [] }
}

function escapeAttr(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const Spreadsheet = TiptapNode.create({
  name: 'spreadsheet',
  group: 'block',
  atom: true,
  selectable: true,
  isolating: true,

  addAttributes() {
    return {
      data: { default: DEFAULT_GRID },
      headers: { default: [] as string[] },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-spreadsheet]',
        getAttrs: (el) => {
          const e = el as HTMLElement
          const { data, headers } = parseGridJson(
            e.getAttribute('data-content') ?? '',
          )
          return { data, headers }
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const out: { data: GridData; headers?: string[] } = {
      data: node.attrs.data ?? DEFAULT_GRID,
    }
    const headers = node.attrs.headers as string[] | undefined
    if (headers && headers.some((h) => h && h.length > 0)) {
      out.headers = headers
    }
    const json = JSON.stringify(out)
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-spreadsheet': 'true',
        'data-content': json,
      }),
    ]
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const wrapper = document.createElement('div')
      wrapper.classList.add('spreadsheet-wrapper')
      wrapper.contentEditable = 'false'

      const toolbar = document.createElement('div')
      toolbar.classList.add('spreadsheet-toolbar')
      wrapper.appendChild(toolbar)

      const inner = document.createElement('div')
      inner.classList.add('spreadsheet-inner')
      wrapper.appendChild(inner)

      let updating = false
      let scheduled = false
      let sheets: any[] = []
      // Remember the last selection — jspreadsheet drops it when focus
      // moves out (e.g., clicking a toolbar button), so we cache it.
      let lastSelection: [number, number, number, number] | null = null

      const flush = () => {
        scheduled = false
        if (updating) return
        if (typeof getPos !== 'function') return
        const pos = getPos()
        if (pos == null) return
        const sheet = sheets[0]
        if (!sheet?.getData) return
        const newData = sheet.getData()
        const rawHeaders = sheet.getHeaders?.(true) ?? []
        const newHeaders = Array.isArray(rawHeaders)
          ? rawHeaders.map((h: string, i: number) =>
              isDefaultColumnName(h, i) ? '' : h,
            )
          : []
        const current = editor.state.doc.nodeAt(pos)
        if (!current) return
        let tr = editor.state.tr
        let changed = false
        if (JSON.stringify(current.attrs.data) !== JSON.stringify(newData)) {
          tr = tr.setNodeAttribute(pos, 'data', newData)
          changed = true
        }
        if (
          JSON.stringify(current.attrs.headers) !== JSON.stringify(newHeaders)
        ) {
          tr = tr.setNodeAttribute(pos, 'headers', newHeaders)
          changed = true
        }
        if (changed) editor.view.dispatch(tr)
      }

      const schedule = () => {
        if (scheduled) return
        scheduled = true
        queueMicrotask(flush)
      }

      // Force-commit the active cell editor before snapshotting (jspreadsheet
      // doesn't fire onchange until Enter/Tab/blur, so a click on the sidebar
      // could lose the in-progress edit).
      const commitAndFlush = () => {
        const sheet = sheets[0]
        try {
          sheet?.closeEditor?.(sheet.edition?.cell, true)
        } catch {}
        schedule()
      }

      const initialData = (node.attrs.data as GridData) ?? DEFAULT_GRID
      const initialHeaders = (node.attrs.headers as string[]) ?? []
      const rows = Math.max(3, initialData.length || 3)
      const cols = Math.max(3, initialData[0]?.length || 3, initialHeaders.length)
      const columns = Array.from({ length: cols }, (_, i) => ({
        width: 110,
        ...(initialHeaders[i] ? { title: initialHeaders[i] } : {}),
      }))

      sheets = (jspreadsheet as any)(inner, {
        worksheets: [
          {
            data: initialData,
            columns,
            minDimensions: [cols, rows],
            tableOverflow: false,
            defaultColWidth: 110,
          },
        ],
        // Disable the built-in context menu — it doesn't dismiss reliably
        // when the spreadsheet is nested inside a ProseMirror NodeView.
        contextMenu: () => null,
        onafterchanges: schedule,
        onchange: schedule,
        oninsertrow: schedule,
        ondeleterow: schedule,
        oninsertcolumn: schedule,
        ondeletecolumn: schedule,
        onblur: commitAndFlush,
        onselection: (_inst: any, x1: number, y1: number, x2: number, y2: number) => {
          lastSelection = [
            Math.min(x1, x2),
            Math.min(y1, y2),
            Math.max(x1, x2),
            Math.max(y1, y2),
          ]
        },
      })

      // ── Inline column-header editor (dblclick on a header cell) ──────────
      const startHeaderEdit = (
        td: HTMLTableCellElement,
        colIndex: number,
      ) => {
        wrapper
          .querySelectorAll('.spreadsheet-header-input')
          .forEach((el) => el.remove())

        const wRect = wrapper.getBoundingClientRect()
        const tdRect = td.getBoundingClientRect()
        const input = document.createElement('input')
        input.className = 'spreadsheet-header-input'
        const s = sheet0()
        input.value =
          (s?.getHeader?.(colIndex) ?? td.textContent ?? '').trim() || ''
        Object.assign(input.style, {
          position: 'absolute',
          left: `${tdRect.left - wRect.left}px`,
          top: `${tdRect.top - wRect.top}px`,
          width: `${tdRect.width}px`,
          height: `${tdRect.height}px`,
          zIndex: '10',
        } as CSSStyleDeclaration)

        let done = false
        const finish = (save: boolean) => {
          if (done) return
          done = true
          input.remove()
          if (!save) return
          const next = input.value.trim()
          try {
            sheet0()?.setHeader?.(colIndex, next || undefined)
          } catch {}
          schedule()
        }
        input.addEventListener('blur', () => finish(true))
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            finish(true)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            finish(false)
          }
          e.stopPropagation()
        })

        wrapper.appendChild(input)
        input.focus()
        input.select()
      }

      inner.addEventListener('dblclick', (ev) => {
        const target = ev.target as HTMLElement
        const td = target.closest('td') as HTMLTableCellElement | null
        if (!td) return
        if (!td.closest('thead')) return
        // First td of the header row is the "select-all" corner; column data
        // starts at cellIndex 1.
        const colIndex = td.cellIndex - 1
        if (colIndex < 0) return
        ev.preventDefault()
        ev.stopPropagation()
        startHeaderEdit(td, colIndex)
      })

      // Suppress the context menu entirely (both the browser native one and
      // jspreadsheet's, which doesn't dismiss reliably inside a ProseMirror
      // NodeView). Capture phase + stopPropagation blocks jspreadsheet's
      // mousedown/contextmenu handlers before they fire.
      const blockContextMenu = (ev: Event) => {
        ev.preventDefault()
        ev.stopPropagation()
      }
      wrapper.addEventListener('contextmenu', blockContextMenu, true)
      wrapper.addEventListener(
        'mousedown',
        (ev: MouseEvent) => {
          if (ev.button === 2) blockContextMenu(ev)
        },
        true,
      )

      // Also commit when the wrapper loses focus (e.g., user clicks sidebar
      // while a cell editor is open).
      wrapper.addEventListener('focusout', (ev: FocusEvent) => {
        if (wrapper.contains(ev.relatedTarget as Node | null)) return
        commitAndFlush()
      })

      // ── Toolbar ───────────────────────────────────────────────────────────
      const mkBtn = (label: string, title: string, onClick: () => void) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.textContent = label
        b.title = title
        b.className = 'spreadsheet-btn'
        // preventDefault on mousedown keeps focus (and thus selection) on the
        // active cell. stopPropagation keeps jspreadsheet from interpreting
        // it as a click outside.
        b.addEventListener('mousedown', (e) => {
          e.preventDefault()
          e.stopPropagation()
        })
        b.addEventListener('click', (e) => {
          e.preventDefault()
          e.stopPropagation()
          onClick()
        })
        return b
      }

      const sheet0 = () => sheets[0]

      toolbar.append(
        mkBtn('+ Row', 'Add a row at the bottom', () => {
          sheet0()?.insertRow()
          schedule()
        }),
        mkBtn('+ Col', 'Add a column at the right', () => {
          sheet0()?.insertColumn()
          schedule()
        }),
        mkBtn('− Row', 'Delete selected rows', () => {
          const s = sheet0()
          if (!s || !lastSelection) return
          const [, y1, , y2] = lastSelection
          const rows: number[] = []
          for (let y = y2; y >= y1; y--) rows.push(y)
          rows.forEach((r) => s.deleteRow(r))
          lastSelection = null
          schedule()
        }),
        mkBtn('− Col', 'Delete selected columns', () => {
          const s = sheet0()
          if (!s || !lastSelection) return
          const [x1, , x2] = lastSelection
          const cols: number[] = []
          for (let x = x2; x >= x1; x--) cols.push(x)
          cols.forEach((c) => s.deleteColumn(c))
          lastSelection = null
          schedule()
        }),
      )

      const decimalLabel = document.createElement('span')
      decimalLabel.className = 'spreadsheet-label'
      decimalLabel.textContent = 'Decimals'
      toolbar.append(decimalLabel)

      // Match `=ROUND(<expr>, <digits>)` (no nested ROUNDs assumed). Group 1
      // captures the inner expression so we can re-wrap or unwrap.
      const ROUND_RE = /^\s*=\s*ROUND\(\s*(.*?)\s*,\s*-?\d+\s*\)\s*$/i

      const applyDecimals = (places: number | null) => {
        const s = sheet0()
        if (!s || !lastSelection) return
        const [x1, y1, x2, y2] = lastSelection
        for (let y = y1; y <= y2; y++) {
          for (let x = x1; x <= x2; x++) {
            const raw = s.getValueFromCoords(x, y)
            if (raw === '' || raw == null) continue
            const rawStr = String(raw)
            const isFormula = rawStr.trimStart().startsWith('=')

            if (isFormula) {
              // Preserve the formula by wrapping with ROUND (or unwrapping).
              const m = rawStr.match(ROUND_RE)
              const inner = m ? m[1] : rawStr.replace(/^\s*=\s*/, '')
              const next =
                places == null ? `=${inner}` : `=ROUND(${inner}, ${places})`
              s.setValueFromCoords(x, y, next, true)
            } else {
              const num = Number(raw)
              if (!Number.isFinite(num)) continue
              const next = places == null ? String(num) : num.toFixed(places)
              s.setValueFromCoords(x, y, next, false)
            }
          }
        }
        schedule()
      }

      const decimalGroup = document.createElement('div')
      decimalGroup.className = 'spreadsheet-decimal-group'
      ;[0, 1, 2, 3, 4].forEach((n) => {
        const b = mkBtn(
          String(n),
          `Round selection to ${n} decimal place${n === 1 ? '' : 's'}`,
          () => applyDecimals(n),
        )
        b.classList.add('spreadsheet-decimal-btn')
        decimalGroup.append(b)
      })
      decimalGroup.append(
        mkBtn('×', 'Clear decimal formatting', () => applyDecimals(null)),
      )
      toolbar.append(decimalGroup)

      return {
        dom: wrapper,
        update(updated) {
          if (updated.type.name !== 'spreadsheet') return false
          const sheet = sheets[0]
          if (!sheet) return true
          const incoming = updated.attrs.data as GridData
          if (
            JSON.stringify(sheet.getData()) !== JSON.stringify(incoming)
          ) {
            updating = true
            try {
              sheet.setData(incoming as any)
            } finally {
              updating = false
            }
          }
          return true
        },
        destroy() {
          try {
            ;(jspreadsheet as any).destroy(inner, true)
          } catch {}
        },
        stopEvent: () => true,
        ignoreMutations: () => true,
      }
    }
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const out: { data: GridData; headers?: string[] } = {
            data: node.attrs.data ?? DEFAULT_GRID,
          }
          const headers = node.attrs.headers as string[] | undefined
          if (headers && headers.some((h) => h && h.length > 0)) {
            out.headers = headers
          }
          state.write('```spreadsheet\n')
          state.write(JSON.stringify(out, null, 2))
          state.ensureNewLine()
          state.write('```')
          state.closeBlock(node)
        },
        parse: {
          setup(md: any) {
            const prev = md.renderer.rules.fence?.bind(md.renderer.rules)
            md.renderer.rules.fence = (
              tokens: any[],
              idx: number,
              options: any,
              env: any,
              slf: any,
            ) => {
              const token = tokens[idx]
              const lang = (token.info ?? '').trim().split(/\s+/)[0]
              if (lang === 'spreadsheet') {
                const escaped = escapeAttr(token.content.trim())
                return `<div data-spreadsheet="true" data-content="${escaped}"></div>\n`
              }
              return prev
                ? prev(tokens, idx, options, env, slf)
                : slf.renderToken(tokens, idx, options)
            }
          },
        },
      },
    }
  },
})

// ── Slash commands ──────────────────────────────────────────────────────────

interface SlashItem {
  title: string
  shortcut: string
  keywords: string[]
  run: (editor: Editor) => void
}

const SLASH_ITEMS: SlashItem[] = [
  {
    title: 'Heading 1',
    shortcut: '/h1',
    keywords: ['h1', 'heading', 'title', '見出し'],
    run: (e) => e.chain().focus().setHeading({ level: 1 }).run(),
  },
  {
    title: 'Heading 2',
    shortcut: '/h2',
    keywords: ['h2', 'heading'],
    run: (e) => e.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    title: 'Heading 3',
    shortcut: '/h3',
    keywords: ['h3', 'heading'],
    run: (e) => e.chain().focus().setHeading({ level: 3 }).run(),
  },
  {
    title: 'Bullet list',
    shortcut: '/ul',
    keywords: ['ul', 'bullet', 'list', 'unordered'],
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    title: 'Numbered list',
    shortcut: '/ol',
    keywords: ['ol', 'number', 'numbered', 'ordered'],
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    title: 'Quote',
    shortcut: '/quote',
    keywords: ['quote', 'blockquote'],
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    title: 'Code block',
    shortcut: '/code',
    keywords: ['code', 'codeblock', 'snippet'],
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    title: 'Divider',
    shortcut: '/hr',
    keywords: ['hr', 'divider', 'separator'],
    run: (e) => e.chain().focus().setHorizontalRule().run(),
  },
  {
    title: 'Table',
    shortcut: '/table',
    keywords: ['table'],
    run: (e) =>
      e
        .chain()
        .focus()
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
  {
    title: 'Spreadsheet',
    shortcut: '/sheet',
    keywords: ['sheet', 'spreadsheet', 'jspreadsheet', 'grid'],
    run: (e) =>
      e
        .chain()
        .focus()
        .insertContent({
          type: 'spreadsheet',
          attrs: { data: DEFAULT_GRID, headers: [] },
        })
        .run(),
  },
]

function filterSlashItems(query: string): SlashItem[] {
  const q = query.toLowerCase().trim()
  if (!q) return SLASH_ITEMS
  return SLASH_ITEMS.filter((item) => {
    if (item.title.toLowerCase().includes(q)) return true
    if (item.shortcut.toLowerCase().includes(q)) return true
    return item.keywords.some((k) => k.toLowerCase().includes(q))
  })
}

class SlashMenu {
  el: HTMLDivElement
  items: SlashItem[] = []
  selected = 0
  onPick: (item: SlashItem) => void = () => {}

  constructor() {
    this.el = document.createElement('div')
    this.el.className = 'slash-menu'
    this.el.style.display = 'none'
    // Block focus-stealing on any mousedown inside the popup so the editor
    // selection (and the blinking caret) stays alive while interacting.
    this.el.addEventListener('mousedown', (e) => e.preventDefault())
    document.body.appendChild(this.el)
  }

  show(items: SlashItem[], rect: DOMRect | null) {
    this.items = items
    this.selected = 0
    this.render()
    if (rect) this.position(rect)
    this.el.style.display = ''
  }

  update(items: SlashItem[], rect: DOMRect | null) {
    this.items = items
    this.selected = Math.min(this.selected, Math.max(0, items.length - 1))
    this.render()
    if (rect) this.position(rect)
  }

  position(rect: DOMRect) {
    const { innerHeight, innerWidth } = window
    const menuH = this.el.offsetHeight || 200
    const menuW = this.el.offsetWidth || 240
    let top = rect.bottom + 4
    if (top + menuH > innerHeight - 8) top = rect.top - menuH - 4
    let left = rect.left
    if (left + menuW > innerWidth - 8) left = innerWidth - menuW - 8
    this.el.style.top = `${Math.max(8, top)}px`
    this.el.style.left = `${Math.max(8, left)}px`
  }

  render() {
    this.el.innerHTML = ''
    if (this.items.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'slash-empty'
      empty.textContent = 'No matches'
      this.el.appendChild(empty)
      return
    }
    this.items.forEach((item, i) => {
      const row = document.createElement('div')
      row.className = 'slash-item' + (i === this.selected ? ' active' : '')
      row.dataset.idx = String(i)
      const title = document.createElement('span')
      title.className = 'slash-title'
      title.textContent = item.title
      const sc = document.createElement('span')
      sc.className = 'slash-shortcut'
      sc.textContent = item.shortcut
      row.append(title, sc)
      row.addEventListener('mouseenter', () => this.highlight(i))
      row.addEventListener('click', () => this.onPick(item))
      this.el.appendChild(row)
    })
  }

  highlight(i: number) {
    if (i === this.selected) return
    this.selected = i
    this.el.querySelectorAll('.slash-item').forEach((el, idx) => {
      el.classList.toggle('active', idx === i)
    })
  }

  next() {
    if (!this.items.length) return
    this.selected = (this.selected + 1) % this.items.length
    this.render()
  }
  prev() {
    if (!this.items.length) return
    this.selected = (this.selected - 1 + this.items.length) % this.items.length
    this.render()
  }
  current(): SlashItem | undefined {
    return this.items[this.selected]
  }
  hide() {
    this.el.style.display = 'none'
  }
  destroy() {
    this.el.remove()
  }
}

const SlashCommands = Extension.create({
  name: 'slashCommands',
  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      Suggestion({
        editor,
        char: '/',
        startOfLine: false,
        allowSpaces: false,
        items: ({ query }) => filterSlashItems(query),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run()
          ;(props as SlashItem).run(editor)
        },
        render: () => {
          let menu: SlashMenu | null = null
          let latest: any = null
          return {
            onStart: (props: any) => {
              latest = props
              menu = new SlashMenu()
              menu.onPick = (item) => props.command(item)
              menu.show(props.items, props.clientRect?.() ?? null)
            },
            onUpdate: (props: any) => {
              latest = props
              if (!menu) return
              menu.onPick = (item) => props.command(item)
              menu.update(props.items, props.clientRect?.() ?? null)
            },
            onKeyDown: ({ event }: { event: KeyboardEvent }) => {
              if (!menu) return false
              if (event.key === 'ArrowDown') {
                menu.next()
                return true
              }
              if (event.key === 'ArrowUp') {
                menu.prev()
                return true
              }
              if (event.key === 'Enter') {
                const item = menu.current()
                if (item && latest) {
                  latest.command(item)
                  return true
                }
              }
              if (event.key === 'Escape') {
                menu.hide()
                return true
              }
              return false
            },
            onExit: () => {
              menu?.destroy()
              menu = null
            },
          }
        },
      }),
    ]
  },
})

// ── Resizable image (extends @tiptap/extension-image) ───────────────────────

const ResizableImage = Image.extend({
  addOptions() {
    return {
      ...this.parent?.(),
      inline: false,
      allowBase64: true,
    }
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => {
          const v = (el as HTMLElement).getAttribute('width')
          if (!v) return null
          const n = parseInt(v, 10)
          return Number.isFinite(n) && n > 0 ? n : null
        },
        renderHTML: (attrs: any) =>
          attrs.width ? { width: String(attrs.width) } : {},
      },
    }
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const wrapper = document.createElement('span')
      wrapper.className = 'image-wrapper'

      const img = document.createElement('img')
      img.src = node.attrs.src
      if (node.attrs.alt) img.alt = node.attrs.alt
      if (node.attrs.width) img.style.width = `${node.attrs.width}px`
      wrapper.appendChild(img)

      const handle = document.createElement('span')
      handle.className = 'image-resize-handle'
      handle.setAttribute('aria-hidden', 'true')
      wrapper.appendChild(handle)

      handle.addEventListener('mousedown', (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        const startX = ev.clientX
        const startW = img.getBoundingClientRect().width
        document.body.style.cursor = 'nwse-resize'

        const onMove = (e: MouseEvent) => {
          const dx = e.clientX - startX
          const next = Math.max(40, Math.round(startW + dx))
          img.style.width = `${next}px`
        }
        const onUp = () => {
          document.body.style.cursor = ''
          document.removeEventListener('mousemove', onMove)
          document.removeEventListener('mouseup', onUp)
          if (typeof getPos !== 'function') return
          const pos = getPos()
          if (pos == null) return
          const finalW = Math.round(img.getBoundingClientRect().width)
          editor.view.dispatch(
            editor.state.tr.setNodeAttribute(pos, 'width', finalW),
          )
        }
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
      })

      return {
        dom: wrapper,
        update(updated) {
          if (updated.type.name !== 'image') return false
          if (img.src !== updated.attrs.src) img.src = updated.attrs.src
          img.alt = updated.attrs.alt ?? ''
          img.style.width = updated.attrs.width
            ? `${updated.attrs.width}px`
            : ''
          return true
        },
        selectNode() {
          wrapper.classList.add('selected')
        },
        deselectNode() {
          wrapper.classList.remove('selected')
        },
        stopEvent(e) {
          return e.target === handle || handle.contains(e.target as Node)
        },
      }
    }
  },

  addStorage() {
    const parent = (this.parent?.() ?? {}) as Record<string, any>
    return {
      ...parent,
      markdown: {
        ...(parent.markdown ?? {}),
        serialize(state: any, node: any) {
          const { src, alt, width } = node.attrs
          const altE = String(alt ?? '').replace(/"/g, '&quot;')
          if (width) {
            const srcE = String(src ?? '').replace(/"/g, '&quot;')
            state.write(`<img src="${srcE}" alt="${altE}" width="${width}">`)
          } else {
            state.write(`![${alt ?? ''}](${src})`)
          }
          state.closeBlock(node)
        },
        parse: { setup() {} },
      },
    }
  },
})

// ── Image paste / drag-and-drop ─────────────────────────────────────────────

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

const ImagePaste = Extension.create({
  name: 'imagePaste',
  addProseMirrorPlugins() {
    const editor = this.editor
    const insertImage = (src: string, pos?: number) => {
      const node = editor.schema.nodes.image?.create({ src })
      if (!node) return
      const { state, view } = editor
      const tr = pos != null ? state.tr.insert(pos, node) : state.tr.replaceSelectionWith(node)
      view.dispatch(tr)
    }
    return [
      new Plugin({
        props: {
          handlePaste(_view, event) {
            const items = event.clipboardData?.items
            if (!items) return false
            const imageItems = Array.from(items).filter((it) =>
              it.type.startsWith('image/'),
            )
            if (imageItems.length === 0) return false
            for (const item of imageItems) {
              const file = item.getAsFile()
              if (!file) continue
              fileToDataURL(file).then((src) => insertImage(src))
            }
            event.preventDefault()
            return true
          },
          handleDrop(view, event, _slice, moved) {
            if (moved) return false
            const files = Array.from(event.dataTransfer?.files ?? []).filter(
              (f) => f.type.startsWith('image/'),
            )
            if (files.length === 0) return false
            const pos = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            })?.pos
            for (const file of files) {
              fileToDataURL(file).then((src) => insertImage(src, pos))
            }
            event.preventDefault()
            return true
          },
        },
      }),
    ]
  },
})

export const editorExtensions = [
  StarterKit,
  TableKit.configure({ table: { resizable: true } }),
  ResizableImage,
  Spreadsheet,
  Markdown.configure({ html: true, linkify: true, tightLists: true }),
  SlashCommands,
  ImagePaste,
]
