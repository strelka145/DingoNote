import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import { suggestionRenderer } from './suggestion-menu'

export interface WikiLinkSuggestionOptions {
  // Known note titles offered by the `[[` autocomplete. Supplied per-editor by
  // the app (see buildExtensions).
  titles: () => string[]
}

// Autocomplete triggered by `[[`.
export const WikiLinkSuggestion = Extension.create<WikiLinkSuggestionOptions>({
  name: 'wikilinkSuggestion',

  addOptions() {
    return { titles: () => [] }
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    const { titles } = this.options
    return [
      Suggestion({
        editor,
        pluginKey: new PluginKey('wikilink-suggestion'),
        char: '[[',
        startOfLine: false,
        allowSpaces: true,
        items: ({ query }) => {
          const q = query.toLowerCase().trim()
          const all = titles().filter(Boolean)
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
        render: suggestionRenderer<string>({
          emptyText: 'No matching notes',
          renderRow: (title, row) => {
            const t = document.createElement('span')
            t.className = 'slash-title'
            t.textContent = title
            row.appendChild(t)
          },
        }),
      }),
    ]
  },
})
