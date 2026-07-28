import {
  type Editor,
  Extension,
  Node as TiptapNode,
  mergeAttributes,
} from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import nim from 'highlight.js/lib/languages/nim'

const lowlight = createLowlight(common)
lowlight.register('nim', nim)
import { Markdown } from 'tiptap-markdown'
import Suggestion from '@tiptap/suggestion'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { TablePaste } from './extensions/table-paste'
import { FlexibleListItem } from './extensions/flexible-list-item'
import { ResizableImage } from './extensions/resizable-image'
import { ImagePaste } from './extensions/image-paste'
import jspreadsheet from 'jspreadsheet-ce'

// ── Spreadsheet node ─────────────────────────────────────────────────────────

import {
  type GridData,
  type ColumnDecimals,
  DEFAULT_GRID,
  decimalsMask,
  deriveColumnDecimals,
  columnHasText,
  trimTrailingEmptyRows,
  isDefaultColumnName,
  parseGridJson,
  escapeAttr,
  buildSheetJson,
} from './spreadsheet-model'
import { matchWikilink, renderWikilink } from './wikilink'
import {
  spreadsheetCommitters,
  notifySpreadsheetChange,
  templatesProvider,
  templateLoader,
  wikilinkTitles,
  wikilinkNavigate,
} from './editor-context'
// Re-export the runtime-wiring API from here so App.svelte keeps a single
// import surface (`./lib/editor`); the state itself lives in editor-context.
export {
  commitAllSpreadsheets,
  setSpreadsheetChangeListener,
  setTemplatesProvider,
  setWikilinkContext,
  setVaultPathProvider,
  type TemplateRef,
} from './editor-context'

const Spreadsheet = TiptapNode.create({
  name: 'spreadsheet',
  group: 'block',
  atom: true,
  selectable: true,
  isolating: true,

  addAttributes() {
    // The actual values live inside `data-content` as JSON; the per-attribute
    // parsers below read from there. `renderHTML: () => ({})` suppresses
    // TipTap's default behaviour of stringifying the attr onto the DOM,
    // which would otherwise corrupt the 2-D array into
    // `data="a,b,c,d"` via `Array.prototype.toString()` and break copy-paste.
    const readData = (el: HTMLElement) =>
      parseGridJson(el.getAttribute('data-content') ?? '').data
    const readHeaders = (el: HTMLElement) =>
      parseGridJson(el.getAttribute('data-content') ?? '').headers
    const readDecimals = (el: HTMLElement) =>
      parseGridJson(el.getAttribute('data-content') ?? '').decimals
    return {
      data: {
        default: DEFAULT_GRID,
        parseHTML: readData,
        renderHTML: () => ({}),
      },
      headers: {
        default: [] as string[],
        parseHTML: readHeaders,
        renderHTML: () => ({}),
      },
      decimals: {
        default: [] as ColumnDecimals,
        parseHTML: readDecimals,
        renderHTML: () => ({}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-spreadsheet]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-spreadsheet': 'true',
        'data-content': JSON.stringify(buildSheetJson(node)),
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
          // Store a copy, not jspreadsheet's live array. Otherwise attrs.data
          // and the grid's internal data become the same reference, the next
          // edit mutates both in place, and this comparison can never see a
          // difference again — silently dropping every subsequent edit.
          tr = tr.setNodeAttribute(
            pos,
            'data',
            newData.map((r: string[]) => r.slice()),
          )
          changed = true
        }
        if (
          JSON.stringify(current.attrs.headers) !== JSON.stringify(newHeaders)
        ) {
          tr = tr.setNodeAttribute(pos, 'headers', newHeaders)
          changed = true
        }
        // Re-derive decimals from jspreadsheet's live column masks (see
        // deriveColumnDecimals): reading the masks back keeps `decimals` aligned
        // to the data after jspreadsheet shifts columns on insert/delete/move.
        const newDecimals = deriveColumnDecimals(
          (sheet.options?.columns as any[]) ?? [],
          newData[0]?.length ?? 0,
        )
        if (
          JSON.stringify(current.attrs.decimals ?? []) !==
          JSON.stringify(newDecimals)
        ) {
          tr = tr.setNodeAttribute(pos, 'decimals', newDecimals)
          changed = true
        }
        if (changed) {
          editor.view.dispatch(tr)
          // setNodeAttribute doesn't reliably fire TipTap's onUpdate, so notify
          // the app explicitly to re-serialize and schedule a save.
          notifySpreadsheetChange()
        }
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
        } catch {
          /* jspreadsheet/DOM edge (no open editor, detached node, or teardown) — safe to ignore */
        }
        schedule()
      }

      // Synchronous variant for the app to call before saving. Unlike
      // commitAndFlush (which defers the snapshot to a microtask), this pushes
      // the data into the document immediately so a save reads the latest grid.
      // When the user is actively editing a cell here, the open editor is left
      // alone — committed cells still flush, and the live cell commits on blur.
      const commitNow = () => {
        const sheet = sheets[0]
        if (!sheet) return
        if (!wrapper.contains(document.activeElement)) {
          try {
            sheet.closeEditor?.(sheet.edition?.cell, true)
          } catch {
          /* jspreadsheet/DOM edge (no open editor, detached node, or teardown) — safe to ignore */
        }
        }
        flush()
      }
      spreadsheetCommitters.add(commitNow)

      // jspreadsheet's onchange/onafterchanges don't reliably fire on cell
      // commit inside the webview, so committed edits never reach the document.
      // Watch the rendered grid for DOM changes as an event-independent fallback
      // and flush whenever a cell's content actually changes. flush() is a no-op
      // when getData() matches the node attrs, so the echo from our own setData
      // (and from selection/highlight churn) is harmless.
      const gridObserver = new MutationObserver(() => schedule())
      queueMicrotask(() => {
        try {
          gridObserver.observe(inner, {
            subtree: true,
            childList: true,
            characterData: true,
          })
        } catch {
          /* jspreadsheet/DOM edge (no open editor, detached node, or teardown) — safe to ignore */
        }
      })

      const initialData = (node.attrs.data as GridData) ?? DEFAULT_GRID
      const initialHeaders = (node.attrs.headers as string[]) ?? []
      const initialDecimals = (node.attrs.decimals as ColumnDecimals) ?? []
      // Trim trailing empty rows so jspreadsheet's min-rows padding doesn't
      // linger as a phantom row. An all-empty sheet falls back to DEFAULT_GRID
      // so a freshly-inserted spreadsheet still opens with a usable 3×3 grid.
      const trimmed = trimTrailingEmptyRows(initialData)
      const gridData = trimmed.length ? trimmed : DEFAULT_GRID
      const rows = gridData.length
      const cols = Math.max(3, gridData[0]?.length || 3, initialHeaders.length)
      const columns = Array.from({ length: cols }, (_, i) => ({
        width: 110,
        ...(initialHeaders[i] ? { title: initialHeaders[i] } : {}),
        // Display-only decimal formatting (see ColumnDecimals). The stored value
        // stays raw, so dependent formulas use full precision. Never mask a
        // column that holds text — a numeric mask would garble it.
        ...(initialDecimals[i] != null && !columnHasText(gridData, i)
          ? { mask: decimalsMask(initialDecimals[i] as number) }
          : {}),
      }))

      sheets = (jspreadsheet as any)(inner, {
        worksheets: [
          {
            // Pass a copy: jspreadsheet mutates its data array in place, and if
            // it shared the node's attrs.data reference, flush's change check
            // (getData() vs attrs.data) would always compare the array to
            // itself and never detect an edit — so edits would never save.
            data: gridData.map((r) => r.slice()),
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
        // Put raw cell values (formulas) on the system clipboard instead of
        // jspreadsheet's default computed/displayed values. Same-sheet paste
        // already uses the internal buffer (formulas preserved), but cross-sheet
        // paste goes through the clipboard — without this it would paste values
        // only. Note: relative references are NOT re-adjusted on cross-sheet
        // paste (clipboard text bypasses jspreadsheet's offset logic).
        oncopy: (instance: any, range: number[]) => {
          const [c1, r1, c2, r2] = range
          const data = instance.options.data
          const out: string[] = []
          for (let r = r1; r <= r2; r++) {
            const cells: string[] = []
            for (let c = c1; c <= c2; c++) cells.push(data[r]?.[c] ?? '')
            out.push(cells.join('\t'))
          }
          return out.join('\r\n')
        },
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
          } catch {
          /* jspreadsheet/DOM edge (no open editor, detached node, or teardown) — safe to ignore */
        }
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

      // Set a display-only decimal format on the column(s) spanned by the
      // selection. Unlike wrapping cells in ROUND(), this is a native
      // jspreadsheet column mask: the stored value/formula keeps full
      // precision, so downstream formulas are unaffected. jspreadsheet-ce masks
      // are per-column (there is no per-cell numeric format), so this applies
      // to whole columns. `places === null` clears the format.
      const applyDecimals = (places: number | null) => {
        const s = sheet0()
        if (!s || !lastSelection) return
        const data = s.getData(false) as GridData
        const colCount = data[0]?.length ?? 0
        const [x1, , x2] = lastSelection
        if (!s.options.columns) s.options.columns = []
        for (let x = x1; x <= Math.min(x2, colCount - 1); x++) {
          // Skip text columns: a numeric mask would garble their display.
          if (places != null && columnHasText(data, x)) continue
          if (!s.options.columns[x]) s.options.columns[x] = {}
          s.options.columns[x].mask =
            places == null ? undefined : decimalsMask(places)
        }
        // Re-render so the new mask takes effect. getData(false) returns raw
        // values/formulas, so nothing is rounded — only the display changes.
        updating = true
        try {
          s.setData(s.getData(false))
        } finally {
          updating = false
        }
        // flush() re-derives `decimals` from these column masks and triggers the
        // save — keeping it the single source of truth for the format.
        schedule()
      }

      const decimalGroup = document.createElement('div')
      decimalGroup.className = 'spreadsheet-decimal-group'
      ;[0, 1, 2, 3, 4].forEach((n) => {
        const b = mkBtn(
          String(n),
          `Show ${n} decimal place${n === 1 ? '' : 's'} in this column (display only)`,
          () => applyDecimals(n),
        )
        b.classList.add('spreadsheet-decimal-btn')
        decimalGroup.append(b)
      })
      decimalGroup.append(
        mkBtn('×', 'Clear column decimal formatting', () => applyDecimals(null)),
      )
      toolbar.append(decimalGroup)

      return {
        dom: wrapper,
        update(updated) {
          if (updated.type.name !== 'spreadsheet') return false
          const sheet = sheets[0]
          if (!sheet) return true
          // Re-sync jspreadsheet to the node attrs. Besides data, headers and
          // decimals are handled too, so an undo/redo (or external attr change)
          // reverts the column titles and number formats in the display — not
          // just the cell values. `updating` guards the flush the resulting DOM
          // mutations would otherwise trigger.
          updating = true
          try {
            const colCount = sheet.getData()?.[0]?.length ?? 0

            // Column titles (a default letter and "" are equivalent).
            const wantHeaders = (updated.attrs.headers as string[]) ?? []
            const curHeaders = (sheet.getHeaders?.(true) as string[]) ?? []
            for (let x = 0; x < colCount; x++) {
              const want = wantHeaders[x] ?? ''
              const cur = isDefaultColumnName(curHeaders[x] ?? '', x)
                ? ''
                : curHeaders[x] ?? ''
              if (cur === want) continue
              if (want) sheet.setHeader(x, want)
              else sheet.setHeader(x) // reset to the default column letter
            }

            // Column decimal formats (display-only masks).
            const wantDecimals = (updated.attrs.decimals as ColumnDecimals) ?? []
            if (!sheet.options.columns) sheet.options.columns = []
            let masksChanged = false
            for (let x = 0; x < colCount; x++) {
              const wantMask =
                wantDecimals[x] == null
                  ? undefined
                  : decimalsMask(wantDecimals[x] as number)
              if (!sheet.options.columns[x]) sheet.options.columns[x] = {}
              if (sheet.options.columns[x].mask !== wantMask) {
                sheet.options.columns[x].mask = wantMask
                masksChanged = true
              }
            }

            // Cell values — also re-render when masks changed so the new
            // format takes effect even if the data itself is unchanged.
            const incoming = updated.attrs.data as GridData
            if (
              masksChanged ||
              JSON.stringify(sheet.getData()) !== JSON.stringify(incoming)
            ) {
              sheet.setData(incoming as any)
            }
          } finally {
            updating = false
          }
          return true
        },
        destroy() {
          spreadsheetCommitters.delete(commitNow)
          try {
            gridObserver.disconnect()
          } catch {
          /* jspreadsheet/DOM edge (no open editor, detached node, or teardown) — safe to ignore */
        }
          try {
            ;(jspreadsheet as any).destroy(inner, true)
          } catch {
          /* jspreadsheet/DOM edge (no open editor, detached node, or teardown) — safe to ignore */
        }
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
          // Keep the JSON on a single line. prosemirror-markdown's
          // state.write() only prefixes the *start* of a write with the block
          // delimiter (e.g. list indentation); embedded newlines bypass it, so
          // multi-line JSON breaks the fence when the spreadsheet is nested in
          // a list and corrupts the note on the next save/load round-trip.
          state.write('```spreadsheet\n')
          state.write(JSON.stringify(buildSheetJson(node)))
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

interface SlashItem {
  title: string
  shortcut: string
  keywords: string[]
  run: (editor: Editor) => void | Promise<void>
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

function templateSlashItems(): SlashItem[] {
  return templatesProvider().map((t) => ({
    title: t.title || 'Untitled template',
    shortcut: '/tmpl',
    keywords: ['template', 'tmpl', (t.title || '').toLowerCase()].filter(
      Boolean,
    ),
    run: async (editor) => {
      const full = await templateLoader(t.id)
      if (!full) return
      const parser = (editor.storage as any).markdown?.parser
      const html = parser?.parse?.(full.content) ?? ''
      editor.chain().focus().insertContent(html).run()
    },
  }))
}

function filterSlashItems(query: string): SlashItem[] {
  const q = query.toLowerCase().trim()
  const all = [...SLASH_ITEMS, ...templateSlashItems()]
  if (!q) return all
  return all.filter((item) => {
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
        pluginKey: new PluginKey('slash-commands'),
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

// ── WikiLink node ────────────────────────────────────────────────────────────

const WikiLink = TiptapNode.create({
  name: 'wikilink',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      title: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'a[data-wikilink]',
        getAttrs: (el) => ({
          title: (el as HTMLElement).getAttribute('data-wikilink') ?? '',
        }),
      },
    ]
  },

  renderHTML({ node }) {
    const t = String(node.attrs.title ?? '')
    return [
      'a',
      {
        'data-wikilink': t,
        href: '#',
        class: 'wikilink',
      },
      t,
    ]
  },

  addNodeView() {
    return ({ node }) => {
      const a = document.createElement('a')
      a.className = 'wikilink'
      a.setAttribute('data-wikilink', node.attrs.title)
      a.setAttribute('href', '#')
      a.textContent = node.attrs.title
      a.contentEditable = 'false'
      const updateExists = () => {
        const exists = wikilinkTitles().includes(node.attrs.title)
        a.classList.toggle('missing', !exists)
      }
      updateExists()
      a.addEventListener('click', (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        wikilinkNavigate(node.attrs.title)
      })
      return {
        dom: a,
        update(updated) {
          if (updated.type.name !== 'wikilink') return false
          a.setAttribute('data-wikilink', updated.attrs.title)
          a.textContent = updated.attrs.title
          updateExists()
          return true
        },
      }
    }
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write(`[[${node.attrs.title}]]`)
        },
        parse: {
          setup(md: any) {
            md.inline.ruler.before(
              'emphasis',
              'wikilink',
              (state: any, silent: boolean) => {
                const m = matchWikilink(state.src, state.pos)
                if (!m) return false
                if (!silent) {
                  const token = state.push('wikilink', '', 0)
                  token.content = m.title
                }
                state.pos = m.end
                return true
              },
            )
            md.renderer.rules.wikilink = (tokens: any[], idx: number) =>
              renderWikilink(tokens[idx].content)
          },
        },
      },
    }
  },
})

// ── WikiLink autocomplete (Suggestion on [[) ────────────────────────────────

const WikiLinkSuggestion = Extension.create({
  name: 'wikilinkSuggestion',
  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      Suggestion({
        editor,
        pluginKey: new PluginKey('wikilink-suggestion'),
        char: '[[',
        startOfLine: false,
        allowSpaces: true,
        items: ({ query }) => {
          const q = query.toLowerCase().trim()
          const all = wikilinkTitles().filter(Boolean)
          if (!q) return all.slice(0, 50)
          return all.filter((t) => t.toLowerCase().includes(q)).slice(0, 50)
        },
        command: ({ editor, range, props }) => {
          const title = String(props)
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent({ type: 'wikilink', attrs: { title } })
            .insertContent(' ')
            .run()
        },
        render: () => {
          let menu: HTMLDivElement | null = null
          let items: string[] = []
          let selected = 0
          let latest: any = null

          const renderMenu = () => {
            if (!menu) return
            menu.innerHTML = ''
            if (items.length === 0) {
              const empty = document.createElement('div')
              empty.className = 'slash-empty'
              empty.textContent = 'No matching notes'
              menu.appendChild(empty)
              return
            }
            items.forEach((title, i) => {
              const row = document.createElement('div')
              row.className = 'slash-item' + (i === selected ? ' active' : '')
              const t = document.createElement('span')
              t.className = 'slash-title'
              t.textContent = title
              row.appendChild(t)
              row.addEventListener('mouseenter', () => {
                if (i === selected) return
                selected = i
                menu!.querySelectorAll('.slash-item').forEach((el, idx) =>
                  el.classList.toggle('active', idx === i),
                )
              })
              row.addEventListener('click', () => latest?.command(title))
              menu!.appendChild(row)
            })
          }

          const position = (rect: DOMRect | null) => {
            if (!menu || !rect) return
            const { innerHeight, innerWidth } = window
            const h = menu.offsetHeight || 200
            const w = menu.offsetWidth || 240
            let top = rect.bottom + 4
            if (top + h > innerHeight - 8) top = rect.top - h - 4
            let left = rect.left
            if (left + w > innerWidth - 8) left = innerWidth - w - 8
            menu.style.top = `${Math.max(8, top)}px`
            menu.style.left = `${Math.max(8, left)}px`
          }

          return {
            onStart: (props: any) => {
              latest = props
              menu = document.createElement('div')
              menu.className = 'slash-menu'
              menu.addEventListener('mousedown', (e) => e.preventDefault())
              document.body.appendChild(menu)
              items = props.items
              selected = 0
              renderMenu()
              position(props.clientRect?.() ?? null)
            },
            onUpdate: (props: any) => {
              latest = props
              if (!menu) return
              items = props.items
              selected = Math.min(selected, Math.max(0, items.length - 1))
              renderMenu()
              position(props.clientRect?.() ?? null)
            },
            onKeyDown: ({ event }: { event: KeyboardEvent }) => {
              if (!menu) return false
              if (event.key === 'ArrowDown') {
                if (items.length) {
                  selected = (selected + 1) % items.length
                  renderMenu()
                }
                return true
              }
              if (event.key === 'ArrowUp') {
                if (items.length) {
                  selected = (selected - 1 + items.length) % items.length
                  renderMenu()
                }
                return true
              }
              if (event.key === 'Enter') {
                if (items[selected] && latest)
                  latest.command(items[selected])
                return true
              }
              if (event.key === 'Escape') {
                menu.remove()
                menu = null
                return true
              }
              return false
            },
            onExit: () => {
              menu?.remove()
              menu = null
            },
          }
        },
      }),
    ]
  },
})

export const editorExtensions = [
  StarterKit.configure({ listItem: false, codeBlock: false }),
  FlexibleListItem,
  CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
  TableKit.configure({ table: { resizable: true } }),
  ResizableImage,
  Spreadsheet,
  WikiLink,
  Markdown.configure({ html: true, linkify: true, tightLists: true }),
  SlashCommands,
  WikiLinkSuggestion,
  ImagePaste,
  TablePaste,
]
