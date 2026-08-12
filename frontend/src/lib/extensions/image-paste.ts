import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'

// Save a pasted/dropped image file into the vault and return its vault-relative
// path. Reading fails or the attachment save fails -> null (paste continues
// without the image rather than aborting).
async function persistImageFile(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const dataUrl = String(reader.result)
        const { api } = await import('../api')
        const rel = await api.saveAttachment(dataUrl)
        resolve(rel)
      } catch (e) {
        // Attachment save failed — paste continues without the image.
        console.warn('saveAttachment failed', e)
        resolve(null)
      }
    }
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

export const ImagePaste = Extension.create({
  name: 'imagePaste',
  addProseMirrorPlugins() {
    const editor = this.editor
    const insertImage = (src: string, pos?: number) => {
      const node = editor.schema.nodes.image?.create({ src })
      if (!node) return
      const { state, view } = editor
      const tr = pos != null ? state.tr.insert(pos, node) : state.tr.replaceSelectionWith(node)
      view.dispatch(tr)
    }
    return [
      new Plugin({
        props: {
          handlePaste(_view, event) {
            const data = event.clipboardData
            if (!data) return false
            const items = Array.from(data.items)

            // Excel / Google Sheets / browser copy bundles a rendered image
            // preview alongside HTML and plain text. If structured content
            // is present, defer to TipTap so the table / formatted text
            // gets pasted instead of the image preview.
            const hasStructuredText = items.some(
              (it) =>
                it.kind === 'string' &&
                (it.type === 'text/html' || it.type === 'text/plain'),
            )
            if (hasStructuredText) return false

            // Pure image paste (screenshot tool, image-only clipboard, etc.) —
            // require kind=file to avoid grabbing in-line image previews.
            const imageFiles = items
              .filter(
                (it) => it.kind === 'file' && it.type.startsWith('image/'),
              )
              .map((it) => it.getAsFile())
              .filter((f): f is File => !!f)
            if (imageFiles.length === 0) return false
            for (const file of imageFiles) {
              persistImageFile(file).then((rel) => {
                if (rel) insertImage(rel)
              })
            }
            event.preventDefault()
            return true
          },
          handleDrop(view, event, _slice, moved) {
            if (moved) return false
            const files = Array.from(event.dataTransfer?.files ?? []).filter(
              (f) => f.type.startsWith('image/'),
            )
            if (files.length === 0) return false
            const pos = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            })?.pos
            for (const file of files) {
              persistImageFile(file).then((rel) => {
                if (rel) insertImage(rel, pos)
              })
            }
            event.preventDefault()
            return true
          },
        },
      }),
    ]
  },
})
