import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import nim from 'highlight.js/lib/languages/nim'

const lowlight = createLowlight(common)
lowlight.register('nim', nim)
import { Markdown } from 'tiptap-markdown'
import { TablePaste } from './extensions/table-paste'
import { FlexibleListItem } from './extensions/flexible-list-item'
import { ResizableImage } from './extensions/resizable-image'
import { ImagePaste } from './extensions/image-paste'
import { SlashCommands } from './extensions/slash-commands'
import { WikiLink } from './extensions/wikilink'
import { WikiLinkSuggestion } from './extensions/wikilink-suggestion'
import { Spreadsheet } from './extensions/spreadsheet'

import type { TemplateRef } from './editor-context'

// Re-export the still-shared editor context (the spreadsheet commit registry
// the store flushes before saving; TemplateRef) so App.svelte keeps a single
// import surface (`./lib/editor`).
export { commitAllSpreadsheets, type TemplateRef } from './editor-context'

// The per-editor wiring the app supplies at construction time. Previously these
// lived as module-mutable singletons in editor-context; passing them as
// extension options instead scopes each to its editor instance (so nothing
// leaks past editor.destroy()) and removes the hidden global state.
export interface EditorContext {
  templates: () => TemplateRef[]
  loadTemplate: (id: string) => Promise<{ content: string } | null>
  wikilinkTitles: () => string[]
  wikilinkNavigate: (title: string) => void
  vaultPath: () => string
  onSpreadsheetChange: () => void
}

export function buildExtensions(ctx: EditorContext) {
  return [
    StarterKit.configure({ listItem: false, codeBlock: false }),
    FlexibleListItem,
    CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
    TableKit.configure({ table: { resizable: true } }),
    ResizableImage.configure({ vaultPath: ctx.vaultPath }),
    Spreadsheet.configure({ onChange: ctx.onSpreadsheetChange }),
    WikiLink.configure({
      titles: ctx.wikilinkTitles,
      navigate: ctx.wikilinkNavigate,
    }),
    Markdown.configure({ html: true, linkify: true, tightLists: true }),
    SlashCommands.configure({
      templates: ctx.templates,
      loadTemplate: ctx.loadTemplate,
    }),
    WikiLinkSuggestion.configure({ titles: ctx.wikilinkTitles }),
    ImagePaste,
    TablePaste,
  ]
}
