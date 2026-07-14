// Pure data helpers for the spreadsheet node — no DOM, no jspreadsheet, no
// TipTap. Kept separate from editor.ts so they can be unit-tested in isolation
// (and as the first slice of the eventual editor.ts split).

export type CellValue = string | number | boolean | null
export type GridData = CellValue[][]
// `decimals[x]` = number of decimal places to DISPLAY for column x (a native
// jspreadsheet column mask). null/absent = no formatting (show the raw value).
// Display-only: the stored cell value / formula keeps full precision, so
// downstream formulas are unaffected (unlike wrapping cells in ROUND()).
export type ColumnDecimals = (number | null)[]
export type SheetState = {
  data: GridData
  headers: string[]
  decimals: ColumnDecimals
}

// jspreadsheet/jSuites numeric mask for n decimal places: 0 -> "0", 2 -> "0.00".
export function decimalsMask(n: number): string {
  return n <= 0 ? '0' : '0.' + '0'.repeat(n)
}

// Inverse of decimalsMask: read a column mask back to a decimal count, or null
// if it is not one of our decimal masks. Used to re-derive `decimals` from
// jspreadsheet's live columns after operations (insert/delete/move column) that
// shift the columns — so the stored decimals never drift out of alignment.
export function maskToDecimals(mask: unknown): number | null {
  if (mask === '0') return 0
  if (typeof mask === 'string') {
    const m = mask.match(/^0\.(0+)$/)
    if (m) return m[1].length
  }
  return null
}

// A numeric mask garbles non-numeric cells (e.g. a text "Memo" cell renders as
// "-2"), so a decimal format must only be applied to columns that hold numbers.
// A column is safe to format when every non-empty cell is a number or a formula
// (empty columns are safe too — there is no text to mangle).
export function columnHasText(data: GridData, x: number): boolean {
  for (const row of data) {
    const v = row?.[x]
    if (v == null || v === '') continue
    const s = String(v).trim()
    if (s.startsWith('=')) continue
    if (!Number.isFinite(Number(s))) return true
  }
  return false
}

export const DEFAULT_GRID: GridData = [
  ['', '', ''],
  ['', '', ''],
  ['', '', ''],
]

export function defaultColumnName(i: number): string {
  let name = ''
  let n = i
  do {
    name = String.fromCharCode(65 + (n % 26)) + name
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return name
}

export function isDefaultColumnName(header: string, i: number): boolean {
  return !header || header === defaultColumnName(i)
}

export function parseGridJson(raw: string): SheetState {
  try {
    const obj = JSON.parse(raw)
    if (Array.isArray(obj)) return { data: obj as GridData, headers: [], decimals: [] }
    if (obj && Array.isArray(obj.data)) {
      return {
        data: obj.data as GridData,
        headers: Array.isArray(obj.headers) ? obj.headers : [],
        decimals: Array.isArray(obj.decimals) ? obj.decimals : [],
      }
    }
  } catch {}
  return { data: DEFAULT_GRID, headers: [], decimals: [] }
}

export function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Build the serialized `{data, headers?, decimals?}` object shared by the DOM
// (data-content) and Markdown fence representations. Optional fields are only
// emitted when they carry information, to keep saved notes clean.
export function buildSheetJson(node: {
  attrs: { data?: GridData; headers?: string[]; decimals?: ColumnDecimals }
}): Record<string, unknown> {
  const out: Record<string, unknown> = { data: node.attrs.data ?? DEFAULT_GRID }
  const headers = node.attrs.headers
  if (headers && headers.some((h) => h && h.length > 0)) out.headers = headers
  const decimals = node.attrs.decimals
  if (decimals && decimals.some((d) => d != null)) out.decimals = decimals
  return out
}
