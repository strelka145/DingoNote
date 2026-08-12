<script lang="ts">
  import { untrack } from 'svelte'
  import { Editor } from '@tiptap/core'
  import { buildExtensions, type EditorContext } from './lib/editor'
  import { api } from './lib/api'
  import type { AppConfig } from './lib/types'
  import { exportToPDF } from './lib/pdf'
  import { store } from './lib/noteStore.svelte'
  import Sidebar from './lib/components/Sidebar.svelte'
  import TagsBar from './lib/components/TagsBar.svelte'
  import SettingsModal from './lib/components/SettingsModal.svelte'

  // DOM- and editor-coupled state stays in the component; all note/template
  // data and operations live in the shared store (lib/noteStore.svelte.ts).
  let editorEl: HTMLDivElement | undefined = $state()
  let editor: Editor | null = null
  let inTable = $state(false)

  $effect(() => {
    localStorage.setItem('notes-sort', store.sortBy)
  })

  let exporting = $state(false)
  let showSettings = $state(false)
  let config = $state<AppConfig>({ vaultPath: '', platform: '', features: { pdfExport: false, nativeFolderPicker: false } })

  // Per-editor wiring passed to buildExtensions. Defined once — the closures
  // read the live store/config/editor each call, so the same object stays valid
  // across editor recreations (note switches). `onSpreadsheetChange` routes
  // through the current `editor`, which is nulled on teardown, so a late flush
  // from a destroyed editor is a no-op.
  const editorContext: EditorContext = {
    templates: () => store.templates.map((t) => ({ id: t.id, title: t.title })),
    loadTemplate: (id) => api.loadTemplate(id),
    wikilinkTitles: () => store.allNoteTitles,
    wikilinkNavigate: (title) => {
      const id = store.allNoteIndex.get(title)
      if (id) {
        if (store.mode !== 'notes') {
          void store.switchMode('notes').then(() => store.select(id))
        } else {
          void store.select(id)
        }
      }
    },
    vaultPath: () => config.vaultPath,
    onSpreadsheetChange: () => {
      if (editor) store.syncFromEditor(editor)
    },
  }

  async function loadConfig() {
    config = await api.configGet()
  }

  async function openSettings() {
    await loadConfig()
    showSettings = true
  }

  async function changeVault(path?: string) {
    const resolved = path ?? await api.pickFolder(config.vaultPath)
    if (!resolved) return
    if (!(await store.flushSave())) return
    config = await api.configSet({ vaultPath: resolved })
    store.current = null
    await store.refresh()
  }

  async function exportPDF() {
    if (!store.current || exporting) return
    if (!(await store.flushSave())) return
    const safeTitle = (store.current.title || 'untitled')
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim() || 'untitled'
    const filename = `${safeTitle}.pdf`

    exporting = true
    try {
      await exportToPDF(filename)
    } finally {
      exporting = false
    }
  }

  $effect(() => {
    if (!editorEl) return
    const initialContent = untrack(() => store.current?.content ?? '')
    const isReadOnly = untrack(() => store.mode === 'archive')
    const e = new Editor({
      element: editorEl,
      extensions: buildExtensions(editorContext),
      content: initialContent,
      autofocus: false,
      editable: !isReadOnly,
      // Table-paste normalization (td->th promotion + header retyping) lives in
      // the TablePaste extension (lib/extensions/table-paste.ts), so the whole
      // paste story is in one place.
      editorProps: {
        scrollMargin: 80,
        scrollThreshold: 80,
      },
      onUpdate: ({ editor }) => store.syncFromEditor(editor),
    })
    editor = e
    store.editor = e
    const syncTableState = () => {
      inTable = e.isActive('table')
    }
    e.on('selectionUpdate', syncTableState)
    e.on('transaction', syncTableState)
    e.on('focus', syncTableState)
    syncTableState()
    return () => {
      e.off('selectionUpdate', syncTableState)
      e.off('transaction', syncTableState)
      e.off('focus', syncTableState)
      inTable = false
      e.destroy()
      editor = null
      store.editor = null
    }
  })

  loadConfig().then(() => store.refresh())
</script>

<main>
  <Sidebar onOpenSettings={openSettings} />

  <section class="editor">
    {#if store.current}
      <div
        class="save-status {store.saveState}"
        title={store.saveState === 'error' ? store.saveError : ''}
      >
        {store.saveState === 'saved'
          ? '✓ saved'
          : store.saveState === 'saving'
            ? '… saving'
            : store.saveState === 'error'
              ? '⚠ ' + store.saveError
              : '● unsaved'}
      </div>
      <input
        class="title-input"
        placeholder="Title"
        bind:value={store.current.title}
        oninput={store.scheduleSave}
      />
      <TagsBar />
      {#key store.current.id}
        <div class="body" bind:this={editorEl}></div>
      {/key}
      <footer class="status">
        {#if inTable}
          <div class="table-controls" aria-label="Table actions">
            <button
              class="table-btn"
              onmousedown={(e) => e.preventDefault()}
              onclick={() => editor?.chain().focus().addRowAfter().run()}
              title="Add row below"
            >+ Row</button>
            <button
              class="table-btn"
              onmousedown={(e) => e.preventDefault()}
              onclick={() => editor?.chain().focus().addColumnAfter().run()}
              title="Add column to the right"
            >+ Col</button>
            <button
              class="table-btn"
              onmousedown={(e) => e.preventDefault()}
              onclick={() => editor?.chain().focus().deleteRow().run()}
              title="Delete current row"
            >− Row</button>
            <button
              class="table-btn"
              onmousedown={(e) => e.preventDefault()}
              onclick={() => editor?.chain().focus().deleteColumn().run()}
              title="Delete current column"
            >− Col</button>
            <button
              class="table-btn danger"
              onmousedown={(e) => e.preventDefault()}
              onclick={() => editor?.chain().focus().deleteTable().run()}
              title="Delete the table"
            >×</button>
          </div>
        {/if}
        <button
          class="export-btn"
          onclick={exportPDF}
          disabled={exporting}
          onmousedown={(e) => e.preventDefault()}
          title="Export as PDF"
        >
          {exporting ? 'Exporting…' : 'Export PDF'}
        </button>
        <span class="status-text">
          {#if store.mode === 'archive'}
            Archived (read-only)
          {:else if store.saveState === 'saved'}
            Saved
          {:else}
            Saving…
          {/if}
        </span>
      </footer>
    {:else}
      <div class="empty">
        <p>
          {store.mode === 'notes'
            ? 'Select a note or create a new one'
            : 'Select a template, or create one to insert with /'}
        </p>
        <button class="new-big" onclick={store.newNote}
          >+ New {store.mode === 'notes' ? 'Note' : 'Template'}</button>
      </div>
    {/if}
  </section>
</main>

<SettingsModal
  bind:open={showSettings}
  vaultPath={config.vaultPath}
  nativeFolderPicker={config.features.nativeFolderPicker}
  onChangeVault={changeVault}
/>

<style>
  main {
    display: grid;
    grid-template-columns: 260px 1fr;
    height: 100vh;
  }

  /* The Settings dialog (.modal* / .setting-* / .path / .hint* / .sort-select*)
     lives in SettingsModal.svelte. The sidebar (aside / .tabs / .settings-btn /
     .new / .search* / .tag-filter* / .tag-label* / list rows / .row-tag*) lives
     in Sidebar.svelte. */

  .editor {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .save-status {
    font-size: 11px;
    padding: 2px 32px;
    color: var(--text-dim);
    font-family: var(--mono);
  }
  .save-status.unsaved {
    color: #d08a3e;
  }
  .save-status.error {
    color: var(--danger, #e5534b);
    font-weight: 600;
  }

  .title-input {
    font-size: 22px;
    font-weight: 600;
    padding: 24px 32px 8px;
    width: 100%;
  }
  .title-input::placeholder {
    color: var(--text-dim);
  }


  .body {
    flex: 1;
    overflow-y: auto;
    /* Reserve space for the scrollbar so its appearance doesn't reflow
       the editor mid-typing and trigger the auto-scroll loop. */
    scrollbar-gutter: stable;
    padding: 12px 40px 32px;
    background-image:
      linear-gradient(to right, var(--grid) 1px, transparent 1px),
      linear-gradient(to bottom, var(--grid) 1px, transparent 1px);
    background-size: 28px 28px;
    background-position: 0 12px;
    background-attachment: local;
  }
  .body :global(.ProseMirror) {
    outline: none;
    min-height: 100%;
    font-size: 16px;
    line-height: 28px;
    color: var(--text);
  }
  .body :global(.ProseMirror > * + *) {
    margin-top: 28px;
  }
  .body :global(.ProseMirror h1) {
    font-size: 28px;
    font-weight: 700;
    line-height: 1.3;
    margin-top: 1.2em;
  }
  .body :global(.ProseMirror h2) {
    font-size: 22px;
    font-weight: 700;
    line-height: 1.3;
    margin-top: 1em;
  }
  .body :global(.ProseMirror h3) {
    font-size: 18px;
    font-weight: 600;
    line-height: 1.3;
  }
  .body :global(.ProseMirror p) {
    margin: 0;
  }
  .body :global(.ProseMirror code) {
    background: var(--bg-hover);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: var(--mono);
    font-size: 0.88em;
  }
  .body :global(.ProseMirror pre) {
    background: var(--bg-hover);
    padding: 12px 16px;
    border-radius: 8px;
    overflow-x: auto;
    font-family: var(--mono);
    font-size: 0.88em;
    line-height: 1.5;
  }
  .body :global(.ProseMirror pre code) {
    background: transparent;
    padding: 0;
    font-size: inherit;
  }
  .body :global(.ProseMirror blockquote) {
    border-left: 3px solid var(--border);
    padding-left: 14px;
    color: var(--text-dim);
  }
  .body :global(.ProseMirror ul),
  .body :global(.ProseMirror ol) {
    padding-left: 24px;
  }
  .body :global(.ProseMirror ul li),
  .body :global(.ProseMirror ol li) {
    margin-bottom: 2px;
  }
  .body :global(.ProseMirror ul li > p),
  .body :global(.ProseMirror ol li > p) {
    margin: 0;
  }
  .body :global(.ProseMirror hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 1.5em 0;
  }
  .body :global(.ProseMirror a) {
    color: var(--accent);
    text-decoration: underline;
  }
  .body :global(.ProseMirror a.wikilink) {
    color: var(--accent);
    text-decoration: none;
    background: var(--accent-bg, rgba(103, 80, 164, 0.12));
    padding: 1px 6px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.95em;
    white-space: nowrap;
  }
  .body :global(.ProseMirror a.wikilink:hover) {
    filter: brightness(1.1);
    text-decoration: underline;
  }
  .body :global(.ProseMirror a.wikilink.missing) {
    color: var(--text-dim);
    background: transparent;
    border: 1px dashed var(--border);
    padding: 0 5px;
  }
  .body :global(.ProseMirror strong) {
    font-weight: 700;
  }
  .body :global(.image-wrapper) {
    position: relative;
    display: inline-block;
    max-width: 100%;
    line-height: 0;
  }
  .body :global(.image-wrapper img) {
    max-width: 100%;
    height: auto;
    border-radius: 6px;
    display: block;
  }
  .body :global(.image-wrapper.selected img) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .body :global(.image-resize-handle) {
    position: absolute;
    right: -5px;
    bottom: -5px;
    width: 12px;
    height: 12px;
    background: var(--accent);
    border: 2px solid var(--bg);
    border-radius: 50%;
    cursor: nwse-resize;
    opacity: 0;
    transition: opacity 0.1s;
  }
  .body :global(.image-wrapper.selected .image-resize-handle),
  .body :global(.image-wrapper:hover .image-resize-handle) {
    opacity: 1;
  }
  .body :global(.ProseMirror table) {
    border-collapse: collapse;
    table-layout: fixed;
    width: 100%;
    margin: 0;
    overflow: hidden;
  }
  .body :global(.ProseMirror th),
  .body :global(.ProseMirror td) {
    border: 1px solid var(--border);
    padding: 6px 10px;
    vertical-align: top;
    min-width: 80px;
    position: relative;
    background: var(--bg);
  }
  .body :global(.ProseMirror th) {
    background: var(--bg-elev);
    font-weight: 600;
    text-align: left;
  }
  .body :global(.ProseMirror .selectedCell) {
    background: var(--bg-active);
  }
  .body :global(.ProseMirror .column-resize-handle) {
    position: absolute;
    right: -2px;
    top: 0;
    bottom: 0;
    width: 4px;
    background: var(--accent);
    pointer-events: none;
    opacity: 0.4;
  }
  .body :global(.ProseMirror.resize-cursor) {
    cursor: col-resize;
  }
  .body :global(.spreadsheet-wrapper) {
    /* Positioning context for the absolutely-placed column-title edit input;
       without it the input resolves against a higher ancestor and jumps to
       the top of the page. */
    position: relative;
    margin: 8px 0;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid var(--border);
    background: var(--bg);
    user-select: none;
  }
  .body :global(.spreadsheet-wrapper .jss_container) {
    width: 100% !important;
    max-width: 100%;
  }
  .body :global(.spreadsheet-wrapper table.jss) {
    width: 100% !important;
  }
  .body :global(.spreadsheet-wrapper .jss > thead > tr > td),
  .body :global(.spreadsheet-wrapper .jss > tbody > tr > td) {
    background: var(--bg);
    color: var(--text);
    border-color: var(--border);
  }
  .body :global(.spreadsheet-wrapper .jss > thead > tr > td:first-child),
  .body :global(.spreadsheet-wrapper .jss > tbody > tr > td.jss_selected) {
    background: var(--bg-active);
  }
  .body :global(.spreadsheet-toolbar) {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-elev);
    font-size: 12px;
    user-select: none;
  }
  .body :global(.spreadsheet-btn) {
    padding: 2px 8px;
    border-radius: 4px;
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    cursor: pointer;
    font-size: 12px;
    line-height: 1.4;
  }
  .body :global(.spreadsheet-btn:hover) {
    background: var(--bg-hover);
  }
  .body :global(.spreadsheet-label) {
    margin-left: 6px;
    color: var(--text-dim);
  }
  .body :global(.spreadsheet-decimal-group) {
    display: flex;
    gap: 2px;
  }
  .body :global(.spreadsheet-decimal-btn) {
    min-width: 26px;
    padding: 2px 6px;
    text-align: center;
  }
  .body :global(.spreadsheet-header-input) {
    position: absolute;
    box-sizing: border-box;
    padding: 0 6px;
    font: inherit;
    font-weight: 600;
    background: var(--bg);
    border: 2px solid var(--accent);
    color: var(--text);
    outline: none;
  }

  .status {
    font-size: 11px;
    color: var(--text-dim);
    padding: 6px 16px 6px 32px;
    border-top: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .status-text {
    margin-left: auto;
  }
  .table-controls {
    display: flex;
    gap: 4px;
    margin-right: auto;
  }
  .table-btn {
    padding: 2px 8px;
    border-radius: 4px;
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    cursor: pointer;
    font-size: 12px;
    line-height: 1.4;
  }
  .table-btn:hover {
    background: var(--bg-hover);
  }
  .table-btn.danger:hover {
    background: var(--danger);
    color: white;
    border-color: var(--danger);
  }

  .export-btn {
    padding: 2px 10px;
    border-radius: 4px;
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    font-size: 11px;
    line-height: 1.4;
    cursor: pointer;
  }
  .export-btn:hover {
    background: var(--bg-hover);
  }
  .export-btn:disabled {
    opacity: 0.5;
    cursor: wait;
  }

  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 16px;
    align-items: center;
    justify-content: center;
    color: var(--text-dim);
  }
  .empty p {
    margin: 0;
  }
  .new-big {
    padding: 8px 16px;
    border-radius: 8px;
    background: var(--accent);
    color: white;
    font-size: 14px;
    font-weight: 500;
  }
  .new-big:hover {
    filter: brightness(1.1);
  }
</style>
