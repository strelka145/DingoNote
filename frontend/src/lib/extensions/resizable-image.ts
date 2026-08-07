import { Image, type ImageOptions } from '@tiptap/extension-image'

export interface ResizableImageOptions {
  // Resolves the current vault path for turning vault-relative image srcs into
  // file:// URLs. Supplied per-editor by the app (see buildExtensions).
  vaultPath: () => string
}

// Resolve a stored image src to something the WKWebView can load. Absolute
// URLs (http/data/blob/file) pass through; a vault-relative path like
// "attachments/x.png" becomes a file:// URL under the given vault.
export function resolveImageSrc(src: string, vaultPath: string): string {
  if (!src) return src
  if (/^(https?|data|blob|file):/.test(src)) return src
  if (!vaultPath) return src
  const cleaned = src.replace(/^\.?\/+/, '')
  return `file://${vaultPath}/${cleaned}`
}

export const ResizableImage = Image.extend<ImageOptions & ResizableImageOptions>({
  addOptions() {
    return {
      ...this.parent?.(),
      inline: false,
      allowBase64: true,
      vaultPath: () => '',
    }
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => {
          const v = (el as HTMLElement).getAttribute('width')
          if (!v) return null
          const n = parseInt(v, 10)
          return Number.isFinite(n) && n > 0 ? n : null
        },
        renderHTML: (attrs: any) =>
          attrs.width ? { width: String(attrs.width) } : {},
      },
    }
  },

  addNodeView() {
    const vaultPath = this.options.vaultPath
    return ({ node, editor, getPos }) => {
      const wrapper = document.createElement('span')
      wrapper.className = 'image-wrapper'

      const img = document.createElement('img')
      img.src = resolveImageSrc(node.attrs.src, vaultPath())
      if (node.attrs.alt) img.alt = node.attrs.alt
      if (node.attrs.width) img.style.width = `${node.attrs.width}px`
      wrapper.appendChild(img)

      const handle = document.createElement('span')
      handle.className = 'image-resize-handle'
      handle.setAttribute('aria-hidden', 'true')
      wrapper.appendChild(handle)

      handle.addEventListener('mousedown', (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        const startX = ev.clientX
        const startW = img.getBoundingClientRect().width
        document.body.style.cursor = 'nwse-resize'

        const onMove = (e: MouseEvent) => {
          const dx = e.clientX - startX
          const next = Math.max(40, Math.round(startW + dx))
          img.style.width = `${next}px`
        }
        const onUp = () => {
          document.body.style.cursor = ''
          document.removeEventListener('mousemove', onMove)
          document.removeEventListener('mouseup', onUp)
          if (typeof getPos !== 'function') return
          const pos = getPos()
          if (pos == null) return
          const finalW = Math.round(img.getBoundingClientRect().width)
          editor.view.dispatch(
            editor.state.tr.setNodeAttribute(pos, 'width', finalW),
          )
        }
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
      })

      return {
        dom: wrapper,
        update(updated) {
          if (updated.type.name !== 'image') return false
          const resolved = resolveImageSrc(updated.attrs.src, vaultPath())
          if (img.src !== resolved) img.src = resolved
          img.alt = updated.attrs.alt ?? ''
          img.style.width = updated.attrs.width
            ? `${updated.attrs.width}px`
            : ''
          return true
        },
        selectNode() {
          wrapper.classList.add('selected')
        },
        deselectNode() {
          wrapper.classList.remove('selected')
        },
        stopEvent(e) {
          return e.target === handle || handle.contains(e.target as Node)
        },
      }
    }
  },

  addStorage() {
    const parent = (this.parent?.() ?? {}) as Record<string, any>
    return {
      ...parent,
      markdown: {
        ...(parent.markdown ?? {}),
        serialize(state: any, node: any) {
          const { src, alt, width } = node.attrs
          const altE = String(alt ?? '').replace(/"/g, '&quot;')
          if (width) {
            const srcE = String(src ?? '').replace(/"/g, '&quot;')
            state.write(`<img src="${srcE}" alt="${altE}" width="${width}">`)
          } else {
            state.write(`![${alt ?? ''}](${src})`)
          }
          state.closeBlock(node)
        },
        parse: { setup() {} },
      },
    }
  },
})
