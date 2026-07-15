// Split `text` into runs, marking the (case-insensitive) matches of `q` so the
// UI can wrap them. Pure — extracted from App.svelte for unit testing.

export type HighlightSegment = { s: string; m: boolean }

export function highlight(text: string, q: string): HighlightSegment[] {
  if (!q || !text) return [{ s: text, m: false }]
  const lower = text.toLowerCase()
  const lq = q.toLowerCase()
  const out: HighlightSegment[] = []
  let i = 0
  while (i < text.length) {
    const idx = lower.indexOf(lq, i)
    if (idx < 0) {
      out.push({ s: text.slice(i), m: false })
      break
    }
    if (idx > i) out.push({ s: text.slice(i, idx), m: false })
    out.push({ s: text.slice(idx, idx + q.length), m: true })
    i = idx + q.length
  }
  return out
}
