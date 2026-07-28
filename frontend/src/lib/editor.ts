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
