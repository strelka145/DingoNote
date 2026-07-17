// Pure logic for the `[[Title]]` wiki-link markdown-it rule, split out of the
// TipTap WikiLink node so it can be unit-tested without a full editor.

export type WikilinkMatch = { title: string; end: number }

// Try to match a `[[Title]]` starting at `src[pos]`. Returns the inner title and
// the position just past the closing `]]`, or null if there is no valid link.
// A title must be non-empty and contain no `[` or newline (so nested/broken
// brackets don't swallow following text).
export function matchWikilink(src: string, pos: number): WikilinkMatch | null {
  if (src.charCodeAt(pos) !== 0x5b) return null // '['
  if (src.charCodeAt(pos + 1) !== 0x5b) return null // second '['
  const close = src.indexOf(']]', pos + 2)
  if (close < 0) return null
  const title = src.slice(pos + 2, close)
  if (title.length === 0 || /[\[\n]/.test(title)) return null
  return { title, end: close + 2 }
}

// Render a wiki-link token to the HTML the editor parses back into a node.
export function renderWikilink(title: string): string {
  const escaped = title
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return `<a data-wikilink="${escaped}" href="#">${escaped}</a>`
}
