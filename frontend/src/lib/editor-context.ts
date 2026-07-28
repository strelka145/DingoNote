// Shared editor context: mutable providers and registries the app wires up at
// runtime, plus small helpers the extensions read them through. Extracted from
// editor.ts so the individual extension modules (lib/extensions/*) can reach
// this state without importing editor.ts itself — which would create a cycle,
// since editor.ts imports the extensions to assemble `editorExtensions`.
//
// The provider `let`s are reassigned by their setters (called once from
// App.svelte on mount). Importers get ES-module live bindings, so they always
// observe the current provider.

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

// The app registers a callback here so a spreadsheet flush can signal a content
// change (re-serialize + schedule save). A setNodeAttribute transaction doesn't
// reliably trigger TipTap's onUpdate, so onUpdate alone misses spreadsheet edits.
let spreadsheetChangeListener: (() => void) | null = null

export function setSpreadsheetChangeListener(fn: (() => void) | null) {
  spreadsheetChangeListener = fn
}

export function notifySpreadsheetChange() {
  spreadsheetChangeListener?.()
}

// ── Templates (slash-command insertion) ─────────────────────────────────────
export let templatesProvider: () => TemplateRef[] = () => []
export let templateLoader: (id: string) => Promise<{ content: string } | null> =
  async () => null

export function setTemplatesProvider(
  provider: () => TemplateRef[],
  loader: (id: string) => Promise<{ content: string } | null>,
) {
  templatesProvider = provider
  templateLoader = loader
}

// ── Wiki-style cross-note links ─────────────────────────────────────────────
// App.svelte supplies the title list and the navigation callback; the editor
// uses these from the wikilink node's click handler and the `[[…]]` autocomplete.
export let wikilinkTitles: () => string[] = () => []
export let wikilinkNavigate: (title: string) => void = () => {}

export function setWikilinkContext(
  titles: () => string[],
  navigate: (title: string) => void,
) {
  wikilinkTitles = titles
  wikilinkNavigate = navigate
}

// ── Vault path ──────────────────────────────────────────────────────────────
// Used to resolve vault-relative image paths (e.g. "attachments/x.png") to
// file:// URLs the WKWebView can load.
export let vaultPathProvider: () => string = () => ''
export function setVaultPathProvider(p: () => string) {
  vaultPathProvider = p
}
