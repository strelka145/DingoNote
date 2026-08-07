// Shared editor context: the cross-cutting spreadsheet commit registry, plus
// the TemplateRef type. Extracted from editor.ts so the individual extension
// modules (lib/extensions/*) can reach this state without importing editor.ts
// itself — which would create a cycle, since editor.ts imports the extensions
// to assemble the editor. (Per-editor wiring — templates, wikilink, vault path,
// spreadsheet onChange — now travels as extension options, not through here.)

export interface TemplateRef {
  id: string
  title: string
}

// ── Spreadsheet commit registry ─────────────────────────────────────────────
// Each live spreadsheet NodeView registers a synchronous "commit" here. The app
// calls commitAllSpreadsheets() right before saving so any pending cell edit is
// pushed into the document first. Spreadsheet edits otherwise reach the doc via
// an async microtask flush, which races with (and loses to) a note switch.
export const spreadsheetCommitters = new Set<() => void>()

export function commitAllSpreadsheets() {
  for (const commit of spreadsheetCommitters) {
    try {
      commit()
    } catch {
      // One sheet failing to commit must not block the others or the save.
    }
  }
}
