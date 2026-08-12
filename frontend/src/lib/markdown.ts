import type { Editor } from '@tiptap/core'
import type { MarkdownStorage } from 'tiptap-markdown'

// tiptap-markdown hangs its storage off editor.storage.markdown but doesn't
// augment TipTap's Storage type, so the editor surfaces it only as `any`. These
// helpers own the one unavoidable cast and hand callers a typed surface.
// MarkdownStorage covers getMarkdown(); the markdown-it-backed `parser` it also
// carries is internal (absent from the published type), so we describe just the
// `parse` call we use — it returns HTML.
interface MarkdownParser {
  parse(content: string): string
}
type EditorMarkdownStorage = MarkdownStorage & { parser?: MarkdownParser }

function markdownStorage(editor: Editor): EditorMarkdownStorage {
  return editor.storage.markdown as unknown as EditorMarkdownStorage
}

// Serialize the current document to Markdown.
export function getMarkdown(editor: Editor): string {
  return markdownStorage(editor).getMarkdown()
}

// Parse a Markdown string into HTML for insertion into the document.
export function markdownToHtml(editor: Editor, content: string): string {
  return markdownStorage(editor).parser?.parse(content) ?? ''
}
