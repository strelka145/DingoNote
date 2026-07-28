import { Node as TiptapNode } from '@tiptap/core'
import { matchWikilink, renderWikilink } from '../wikilink'
import { wikilinkTitles, wikilinkNavigate } from '../editor-context'

export const WikiLink = TiptapNode.create({
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
