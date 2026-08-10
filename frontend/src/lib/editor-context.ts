// The TemplateRef type, shared by the slash-command extension and the app.
// Kept in its own module (rather than editor.ts) so the extension modules
// (lib/extensions/*) can import it without pulling in editor.ts — which would
// create a cycle, since editor.ts imports the extensions to assemble the
// editor. (Per-editor wiring — templates, wikilink, vault path, spreadsheet
// onChange, and the spreadsheet commit registry — now travels through the
// editor itself, as extension options and editor.storage, not through here.)

export interface TemplateRef {
  id: string
  title: string
}
