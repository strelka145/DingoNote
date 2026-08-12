// All table-paste normalization in one place (§10-3). Two complementary passes,
// both provided by a single ProseMirror plugin:
//
//  1. transformPastedHTML — Excel / Google Sheets emit tables with only <td>
//     (no <thead>/<th>), so TipTap treats every row as a data row and the table
//     ends up headerless. Promote the first row's cells to <th> when none are
//     present, so pasted tables keep a sensible header. Runs on the raw HTML
//     string before parsing.
//
//  2. transformPasted — retype the parsed cells based on the paste target:
//     into a body cell -> demote all headers to cells (otherwise stray extra
//     "title" rows appear); at top level / into a header -> the first row of
//     each table (or loose row run) becomes the header, the rest body.
//
// Previously #1 lived in App.svelte's editorProps and #2 in editor.ts; keeping
// both here means the whole td/th paste story is in one file.

import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { Fragment, Slice } from '@tiptap/pm/model'

function promoteHeaderlessTables(html: string): string {
  if (!html || !/<table\b/i.test(html)) return html
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    doc.querySelectorAll('table').forEach((table) => {
      if (table.querySelector('th')) return
      const firstRow = table.querySelector('tr')
      if (!firstRow) return
      firstRow.querySelectorAll('td').forEach((td) => {
        const th = doc.createElement('th')
        th.innerHTML = td.innerHTML
        for (const attr of Array.from(td.attributes)) {
          th.setAttribute(attr.name, attr.value)
        }
        td.replaceWith(th)
      })
    })
    return doc.body.innerHTML
  } catch {
    // On any DOM-parse failure, leave the pasted HTML untouched.
    return html
  }
}

const mapFrag = (frag: Fragment, fn: (n: any) => any): Fragment => {
  const out: any[] = []
  frag.forEach((n) => out.push(fn(n)))
  return Fragment.fromArray(out)
}

// Re-type every cell in a row (tableHeader <-> tableCell), keeping content.
const retypeRow = (row: any, type: any): any =>
  row.copy(mapFrag(row.content, (c) => type.create(c.attrs, c.content, c.marks)))

// Body target: pasted cells fill body positions, so demote all header
// cells — otherwise they render as stray extra "title" rows/cells.
const demoteAll = (frag: Fragment, schema: any): Fragment => {
  const cell = schema.nodes.tableCell
  const header = schema.nodes.tableHeader
  return mapFrag(frag, (n) =>
    n.type === header
      ? cell.create(n.attrs, demoteAll(n.content, schema), n.marks)
      : n.copy(demoteAll(n.content, schema)),
  )
}

// Top-level / header target: make each pasted table (or loose row run) have
// exactly one header row = its first row, the rest body.
const firstRowHeader = (frag: Fragment, schema: any): Fragment => {
  const header = schema.nodes.tableHeader
  const cell = schema.nodes.tableCell
  let rowIdx = 0
  return mapFrag(frag, (n) => {
    if (n.type.name === 'table') {
      let i = 0
      return n.copy(mapFrag(n.content, (row) => retypeRow(row, i++ === 0 ? header : cell)))
    }
    if (n.type.name === 'tableRow') {
      return retypeRow(n, rowIdx++ === 0 ? header : cell)
    }
    return n
  })
}

export const TablePaste = Extension.create({
  name: 'tablePaste',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          transformPastedHTML: (html) => promoteHeaderlessTables(html),
          transformPasted: (slice, view) => {
            const schema = view.state.schema
            if (!schema.nodes.tableHeader || !schema.nodes.tableCell) return slice
            // Where is the caret? Inside a body cell -> demote; inside a header
            // cell or outside any table -> first row becomes the header.
            const $from = view.state.selection.$from
            let inBodyCell = false
            for (let d = $from.depth; d > 0; d--) {
              const name = $from.node(d).type.name
              if (name === 'tableCell') { inBodyCell = true; break }
              if (name === 'tableHeader') break
            }
            const content = inBodyCell
              ? demoteAll(slice.content, schema)
              : firstRowHeader(slice.content, schema)
            return new Slice(content, slice.openStart, slice.openEnd)
          },
        },
      }),
    ]
  },
})
