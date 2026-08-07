import { Extension, type Editor } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import { DEFAULT_GRID } from '../spreadsheet-model'
import type { TemplateRef } from '../editor-context'
import { suggestionRenderer } from './suggestion-menu'

export interface SlashCommandsOptions {
  // Templates offered as `/tmpl` slash items, and a loader for their bodies.
  // Supplied per-editor by the app (see buildExtensions).
  templates: () => TemplateRef[]
  loadTemplate: (id: string) => Promise<{ content: string } | null>
}

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

function templateSlashItems(opts: SlashCommandsOptions): SlashItem[] {
  return opts.templates().map((t) => ({
    title: t.title || 'Untitled template',
    shortcut: '/tmpl',
    keywords: ['template', 'tmpl', (t.title || '').toLowerCase()].filter(
      Boolean,
    ),
    run: async (editor) => {
      const full = await opts.loadTemplate(t.id)
      if (!full) return
      const parser = (editor.storage as any).markdown?.parser
      const html = parser?.parse?.(full.content) ?? ''
      editor.chain().focus().insertContent(html).run()
    },
  }))
}

function filterSlashItems(query: string, opts: SlashCommandsOptions): SlashItem[] {
  const q = query.toLowerCase().trim()
  const all = [...SLASH_ITEMS, ...templateSlashItems(opts)]
  if (!q) return all
  return all.filter((item) => {
    if (item.title.toLowerCase().includes(q)) return true
    if (item.shortcut.toLowerCase().includes(q)) return true
    return item.keywords.some((k) => k.toLowerCase().includes(q))
  })
}

export const SlashCommands = Extension.create<SlashCommandsOptions>({
  name: 'slashCommands',

  addOptions() {
    return { templates: () => [], loadTemplate: async () => null }
  },
  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      Suggestion({
        editor,
        pluginKey: new PluginKey('slash-commands'),
        char: '/',
        startOfLine: false,
        allowSpaces: false,
        items: ({ query }) => filterSlashItems(query, this.options),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run()
          ;(props as SlashItem).run(editor)
        },
        render: suggestionRenderer<SlashItem>({
          emptyText: 'No matches',
          renderRow: (item, row) => {
            const title = document.createElement('span')
            title.className = 'slash-title'
            title.textContent = item.title
            const sc = document.createElement('span')
            sc.className = 'slash-shortcut'
            sc.textContent = item.shortcut
            row.append(title, sc)
          },
        }),
      }),
    ]
  },
})
