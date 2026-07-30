<script lang="ts">
  import { untrack } from 'svelte'
  import { Editor } from '@tiptap/core'
  import {
    editorExtensions,
    setTemplatesProvider,
    setWikilinkContext,
    setVaultPathProvider,
    setSpreadsheetChangeListener,
  } from './lib/editor'
  import { api } from './lib/api'
  import { exportToPDF } from './lib/pdf'
  import { highlight } from './lib/highlight'
  import { store } from './lib/noteStore.svelte'

  // DOM- and editor-coupled state stays in the component; all note/template
  // data and operations live in the shared store (lib/noteStore.svelte.ts).
  let editorEl: HTMLDivElement | undefined = $state()
  let editor: Editor | null = null
  let inTable = $state(false)
  let searchInput: HTMLInputElement | undefined = $state()

  $effect(() => {
    localStorage.setItem('notes-sort', store.sortBy)
  })

  setTemplatesProvider(
    () => store.templates.map((t) => ({ id: t.id, title: t.title })),
    (id) => api.loadTemplate(id),
  )

  setWikilinkContext(
    () => store.allNoteTitles,
    (title) => {
      const id = store.allNoteIndex.get(title)
      if (id) {
        if (store.mode !== 'notes') {
          void store.switchMode('notes').then(() => store.select(id))
        } else {
          void store.select(id)
        }
      }
    },
  )

  function clearSearch() {
    store.clearSearch()
    searchInput?.focus()
  }

  function onGlobalKeyDown(ev: KeyboardEvent) {
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') {
      ev.preventDefault()
      searchInput?.focus()
      searchInput?.select()
    }
  }

  let exporting = $state(false)
  let showSettings = $state(false)
  let config = $state<{ vaultPath: string }>({ vaultPath: '' })

  setVaultPathProvider(() => config.vaultPath)

  async function loadConfig() {
    config = await api.configGet()
  }

  async function openSettings() {
    await loadConfig()
    showSettings = true
  }

  async function changeVault() {
    const path = await api.pickFolder(config.vaultPath)
    if (!path) return
    if (!(await store.flushSave())) return
    config = await api.configSet({ vaultPath: path })
    store.current = null
    await store.refresh()
  }

  let gitignoreStatus = $state('')
  async function createGitignore() {
    gitignoreStatus = ''
    const { created } = await api.writeGitignore()
    gitignoreStatus = created
      ? '.gitignore created in the vault.'
      : '.gitignore already exists — left untouched.'
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
      extensions: editorExtensions,
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
    // A spreadsheet cell edit flushes its data into the doc via setNodeAttribute,
    // which doesn't reliably fire onUpdate — sync explicitly so the edit triggers
    // a save on its own (not only when the body is later touched).
    setSpreadsheetChangeListener(() => store.syncFromEditor(e))
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
    }
  })

  $effect(() => {
    window.addEventListener('keydown', onGlobalKeyDown)
    return () => window.removeEventListener('keydown', onGlobalKeyDown)
  })

  loadConfig().then(() => store.refresh())
</script>

<main>
  <aside>
    <header>
      <div class="tabs">
        <button
          class:active={store.mode === 'notes'}
          onclick={() => store.switchMode('notes')}>Notes</button>
        <button
          class:active={store.mode === 'templates'}
          onclick={() => store.switchMode('templates')}>Templates</button>
        <button
          class:active={store.mode === 'archive'}
          onclick={() => store.switchMode('archive')}
          title="Archive — soft-deleted notes">🗑</button>
      </div>
      {#if store.mode !== 'archive'}
        <button
          class="new"
          onclick={store.newNote}
          aria-label={store.mode === 'notes' ? 'New note' : 'New template'}>+</button>
      {/if}
      <button
        class="settings-btn"
        onclick={openSettings}
        aria-label="Settings"
        title="Settings">⚙</button>
    </header>
    <div class="search">
      <input
        bind:this={searchInput}
        bind:value={store.searchQuery}
        oninput={store.debouncedSearch}
        placeholder="Search… (⌘K)"
        type="search"
      />
      {#if store.searchQuery}
        <button class="search-clear" onclick={clearSearch} aria-label="Clear"
          >×</button
        >
      {/if}
    </div>
    {#if store.activeTag}
      <div class="tag-filter">
        Filtered by <span class="tag-label active">#{store.activeTag}</span>
        <button class="tag-filter-clear" onclick={() => (store.activeTag = null)}
          >×</button
        >
      </div>
    {/if}
    <ul>
      {#each store.sortedNotes as note (note.id)}
        <li>
          <button
            class="row"
            class:active={store.current?.id === note.id}
            onclick={() => store.select(note.id)}
          >
            <div class="title">
              {#each highlight(note.title || 'Untitled', store.searchQuery) as seg}
                {#if seg.m}<mark>{seg.s}</mark>{:else}{seg.s}{/if}
              {/each}
            </div>
            {#if store.searchQuery && note.snippet}
              <div class="snippet">
                {#each highlight(note.snippet, store.searchQuery) as seg}
                  {#if seg.m}<mark>{seg.s}</mark>{:else}{seg.s}{/if}
                {/each}
              </div>
            {:else}
              <div class="meta">{store.formatDate(note.updatedAt)}</div>
            {/if}
            {#if note.tags?.length}
              <div class="row-tags">
                {#each note.tags as tag}
                  <span class="row-tag" class:active={store.activeTag === tag}
                    >#{tag}</span
                  >
                {/each}
              </div>
            {/if}
          </button>
          {#if store.mode === 'archive'}
            <button
              class="restore"
              onclick={(e) => store.restoreFromArchive(note.id, e)}
              aria-label="Restore"
              title="Restore to Notes">↺</button>
          {:else}
            <button
              class="dup"
              onclick={(e) => store.duplicate(note.id, e)}
              aria-label="Duplicate"
              title="Duplicate">⎘</button>
          {/if}
          <button
            class="del"
            class:pending={store.pendingDeleteId === note.id}
            onclick={(e) => store.remove(note.id, e)}
            aria-label={store.pendingDeleteId === note.id
              ? store.mode === 'archive' ? 'Confirm permanent delete' : 'Confirm delete'
              : store.mode === 'archive' ? 'Delete forever' : 'Delete'}
            title={store.mode === 'archive'
              ? (store.pendingDeleteId === note.id ? 'Delete forever — click again to confirm' : 'Delete forever')
              : (store.pendingDeleteId === note.id ? 'Click again to confirm' : 'Move to archive')}
          >{store.pendingDeleteId === note.id ? '✓' : '×'}</button>
        </li>
      {/each}
      {#if store.notes.length === 0}
        <li class="empty-list">
          {store.searchQuery
            ? 'No matches'
            : store.mode === 'notes'
              ? 'No notes yet'
              : store.mode === 'templates'
                ? 'No templates yet'
                : 'Archive is empty'}
        </li>
      {/if}
    </ul>
  </aside>

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
      <div class="tags-bar">
        {#each store.current.tags ?? [] as tag (tag)}
          <span class="tag-chip">
            <button
              class="tag-label"
              onclick={() => store.filterByTag(tag)}
              class:active={store.activeTag === tag}
              title="Filter by #{tag}">#{tag}</button
            >
            {#if store.mode !== 'archive'}
              <button
                class="tag-x"
                onclick={() => store.removeTag(tag)}
                aria-label="Remove tag #{tag}">×</button
              >
            {/if}
          </span>
        {/each}
        {#if store.mode !== 'archive'}
          <input
            class="tag-input"
            placeholder="add tag…"
            bind:value={store.tagDraft}
            onkeydown={store.onTagKeydown}
            onblur={() => {
              if (store.tagDraft.trim()) {
                store.addTag(store.tagDraft)
                store.tagDraft = ''
              }
            }}
          />
        {/if}
      </div>
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
          {:else if store.dirty}
            Saving…
          {:else}
            Saved
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

{#if showSettings}
  <div
    class="modal-overlay"
    onclick={() => (showSettings = false)}
    role="presentation">
    <div
      class="modal"
      onclick={(e) => e.stopPropagation()}
      role="dialog">
      <header class="modal-header">
        <h2>Settings</h2>
        <button
          class="modal-close"
          onclick={() => (showSettings = false)}
          aria-label="Close">×</button>
      </header>
      <div class="setting-row">
        <label>Vault Location</label>
        <div class="setting-control">
          <code class="path">{config.vaultPath || '(default)'}</code>
          <button class="setting-btn" onclick={changeVault}>Change…</button>
        </div>
        <p class="hint">
          Notes are stored as .md files in this folder. Templates live in a
          hidden <code>.templates/</code> subfolder.
        </p>
      </div>
      <div class="setting-row">
        <label>Version control</label>
        <div class="setting-control">
          <button class="setting-btn" onclick={createGitignore}>
            Create .gitignore
          </button>
          {#if gitignoreStatus}
            <span class="hint inline">{gitignoreStatus}</span>
          {/if}
        </div>
        <p class="hint">
          Drops a <code>.gitignore</code> in the vault for git users. Notes and
          attachments stay tracked; OS junk and the
          <code>.archive/</code> / <code>.templates/</code> folders are ignored.
        </p>
      </div>
      <div class="setting-row">
        <label for="sort-pref">Sort order</label>
        <div class="setting-control">
          <select
            id="sort-pref"
            class="sort-select"
            bind:value={store.sortBy}
          >
            <option value="updated-desc">Updated · newest</option>
            <option value="updated-asc">Updated · oldest</option>
            <option value="title-asc">Title · A→Z</option>
            <option value="title-desc">Title · Z→A</option>
          </select>
        </div>
        <p class="hint">
          How notes, templates, and archived items are ordered in the sidebar.
        </p>
      </div>
    </div>
  </div>
{/if}

<style>
  main {
    display: grid;
    grid-template-columns: 260px 1fr;
    height: 100vh;
  }

  aside {
    background: var(--bg-elev);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  aside header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
  }

  .tabs {
    display: flex;
    gap: 2px;
  }
  .tabs button {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 4px 8px;
    border-radius: 4px;
    color: var(--text-dim);
  }
  .tabs button:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .tabs button.active {
    background: var(--bg-active);
    color: var(--text);
  }
  .settings-btn {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    font-size: 14px;
    color: var(--text-dim);
    margin-left: 4px;
  }
  .settings-btn:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2000;
  }
  .modal {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
    min-width: 480px;
    max-width: 600px;
    padding: 0;
  }
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
  }
  .modal-header h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }
  .modal-close {
    width: 26px;
    height: 26px;
    border-radius: 4px;
    font-size: 18px;
    color: var(--text-dim);
  }
  .modal-close:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .setting-row {
    padding: 20px;
  }
  .setting-row label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }
  .setting-control {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .path {
    flex: 1;
    padding: 6px 10px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-family: var(--mono);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .setting-btn {
    padding: 6px 14px;
    border-radius: 6px;
    background: var(--accent);
    color: white;
    font-size: 13px;
    font-weight: 500;
  }
  .setting-btn:hover {
    filter: brightness(1.1);
  }
  .hint {
    margin: 12px 0 0;
    font-size: 12px;
    color: var(--text-dim);
    line-height: 1.5;
  }
  .hint.inline {
    margin: 0;
    align-self: center;
  }
  .hint code {
    background: var(--bg-elev);
    padding: 1px 6px;
    border-radius: 3px;
    font-family: var(--mono);
    font-size: 11px;
  }

  .new {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    font-size: 18px;
    color: var(--text-dim);
    transition: background 0.15s;
  }
  .new:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 6px 8px;
    overflow-y: auto;
    flex: 1;
  }

  li {
    position: relative;
    display: flex;
    align-items: stretch;
  }

  .row {
    flex: 1;
    text-align: left;
    padding: 10px 12px;
    border-radius: 6px;
    overflow: hidden;
    transition: background 0.1s;
  }
  .row:hover {
    background: var(--bg-hover);
  }
  .row.active {
    background: var(--bg-active);
  }
  .row .title {
    font-size: 14px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-bottom: 2px;
  }
  .row .meta {
    font-size: 11px;
    color: var(--text-dim);
  }

  .del {
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    width: 22px;
    height: 22px;
    border-radius: 4px;
    color: var(--text-dim);
    font-size: 16px;
    opacity: 0;
    transition:
      opacity 0.1s,
      background 0.1s;
  }
  li:hover .del {
    opacity: 1;
  }
  .del:hover {
    background: var(--danger);
    color: white;
  }
  .del.pending {
    opacity: 1;
    background: var(--danger);
    color: white;
  }

  .restore,
  .dup {
    position: absolute;
    right: 32px;
    top: 50%;
    transform: translateY(-50%);
    width: 22px;
    height: 22px;
    border-radius: 4px;
    color: var(--text-dim);
    font-size: 13px;
    line-height: 1;
    opacity: 0;
    transition:
      opacity 0.1s,
      background 0.1s,
      color 0.1s;
  }
  li:hover .restore,
  li:hover .dup {
    opacity: 1;
  }
  .restore:hover,
  .dup:hover {
    background: var(--accent);
    color: white;
  }

  .empty-list {
    text-align: center;
    color: var(--text-dim);
    font-size: 13px;
    padding: 20px;
  }

  .search {
    position: relative;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
  }
  .search input {
    width: 100%;
    padding: 6px 26px 6px 10px;
    border-radius: 6px;
    background: var(--bg);
    border: 1px solid var(--border);
    font-size: 13px;
    color: var(--text);
  }
  .search input::placeholder {
    color: var(--text-dim);
  }
  .search input::-webkit-search-cancel-button {
    -webkit-appearance: none;
    appearance: none;
  }
  .search-clear {
    position: absolute;
    right: 18px;
    top: 50%;
    transform: translateY(-50%);
    width: 18px;
    height: 18px;
    border-radius: 4px;
    color: var(--text-dim);
    font-size: 14px;
    line-height: 1;
  }
  .search-clear:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .sort-select {
    appearance: none;
    -webkit-appearance: none;
    padding: 6px 28px 6px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--text);
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
    background-image:
      linear-gradient(45deg, transparent 50%, var(--text-dim) 50%),
      linear-gradient(135deg, var(--text-dim) 50%, transparent 50%);
    background-position:
      calc(100% - 14px) 50%,
      calc(100% - 10px) 50%;
    background-size: 4px 4px, 4px 4px;
    background-repeat: no-repeat;
  }
  .sort-select:hover {
    background-color: var(--bg-hover);
  }
  .sort-select:focus {
    outline: none;
    border-color: var(--accent);
  }

  .snippet {
    font-size: 11px;
    color: var(--text-dim);
    line-height: 1.4;
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .row mark {
    background: var(--accent-bg, rgba(103, 80, 164, 0.2));
    color: inherit;
    padding: 0 1px;
    border-radius: 2px;
  }

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

  /* ── Tags ─────────────────────────────────────────────────────────────── */
  .tags-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    padding: 0 32px 8px;
  }
  .tag-chip {
    display: inline-flex;
    align-items: center;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 999px;
    overflow: hidden;
  }
  .tag-label {
    font-size: 12px;
    color: var(--text-dim);
    padding: 2px 4px 2px 9px;
    cursor: pointer;
  }
  .tag-label:hover {
    color: var(--text);
  }
  .tag-label.active {
    color: var(--accent, #4a9eff);
    font-weight: 600;
  }
  .tag-x {
    font-size: 13px;
    line-height: 1;
    color: var(--text-dim);
    padding: 2px 7px 2px 2px;
    cursor: pointer;
  }
  .tag-x:hover {
    color: var(--danger, #e5534b);
  }
  .tag-input {
    font-size: 12px;
    border: none;
    background: transparent;
    color: var(--text);
    padding: 2px 4px;
    width: 90px;
  }
  .tag-input::placeholder {
    color: var(--text-dim);
  }
  .row-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }
  .row-tag {
    font-size: 10px;
    color: var(--text-dim);
    background: var(--bg-elev);
    border-radius: 4px;
    padding: 1px 5px;
  }
  .row-tag.active {
    color: var(--accent, #4a9eff);
  }
  .tag-filter {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-dim);
    padding: 4px 12px;
    margin: 0 8px;
  }
  .tag-filter-clear {
    margin-left: auto;
    font-size: 14px;
    color: var(--text-dim);
    cursor: pointer;
  }
  .tag-filter-clear:hover {
    color: var(--text);
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
