import { api } from './api'

// Two animation frames — long enough for a style/layout change to reflow
// before we measure or capture.
function raf2(): Promise<void> {
  return new Promise((r) =>
    requestAnimationFrame(() => requestAnimationFrame(() => r())),
  )
}

// Per-spreadsheet shrink: text reflows at the print column width naturally,
// but jspreadsheet tables don't. For each sheet wider than the print column,
// apply `zoom` so only that sheet scales down, leaving text and other content
// at their natural print size. Returns undo callbacks to restore afterward.
function applySpreadsheetZoom(): Array<() => void> {
  const restoreFns: Array<() => void> = []
  const editorBody = document.querySelector<HTMLElement>('.body')
  if (!editorBody) return restoreFns
  const cs = getComputedStyle(editorBody)
  const innerWidth =
    editorBody.clientWidth -
    parseFloat(cs.paddingLeft || '0') -
    parseFloat(cs.paddingRight || '0')
  document
    .querySelectorAll<HTMLElement>('.spreadsheet-wrapper')
    .forEach((wrapper) => {
      // Measure the actual rightmost edge of the spreadsheet's content,
      // including anything that overflows the wrapper under
      // `overflow: visible`. `scrollWidth` would miss this.
      const wLeft = wrapper.getBoundingClientRect().left
      let maxRight = wLeft
      wrapper.querySelectorAll<HTMLElement>('*').forEach((el) => {
        const r = el.getBoundingClientRect()
        if (r.right > maxRight) maxRight = r.right
      })
      const sheetWidth = maxRight - wLeft
      if (innerWidth > 0 && sheetWidth > innerWidth) {
        const scale = innerWidth / sheetWidth
        const prev = (wrapper.style as any).zoom ?? ''
        ;(wrapper.style as any).zoom = String(scale)
        restoreFns.push(() => {
          ;(wrapper.style as any).zoom = prev
        })
      }
    })
  return restoreFns
}

// The backend signals completion by dispatching a `pdfexport` CustomEvent on
// window. Resolve with its status once.
function waitForExport(): Promise<string> {
  return new Promise((resolve) => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail
      window.removeEventListener('pdfexport', handler)
      resolve(detail?.status ?? 'unknown')
    }
    window.addEventListener('pdfexport', handler, { once: true })
  })
}

// Render the current document to PDF via the backend. Toggles `body.exporting`
// (which narrows #app to the print width via CSS), reflows, applies the
// spreadsheet zoom-to-fit, then waits for the backend's completion event.
export async function exportToPDF(filename: string): Promise<string> {
  document.body.classList.add('exporting')
  // Let layout reflow (body.exporting narrows #app to print width) before
  // measurement / capture.
  await raf2()
  const restoreFns = applySpreadsheetZoom()
  if (restoreFns.length) await raf2()
  const done = waitForExport()
  try {
    await api.exportPDF(filename)
    return await done
  } finally {
    restoreFns.forEach((fn) => fn())
    document.body.classList.remove('exporting')
  }
}
