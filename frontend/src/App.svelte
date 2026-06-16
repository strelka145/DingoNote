<script lang="ts">
  import { untrack } from 'svelte'
  import { Editor } from '@tiptap/core'
  import {
    editorExtensions,
    setTemplatesProvider,
    setWikilinkContext,
  } from './lib/editor'
  import { api } from './lib/api'
  import type { Note, NoteMeta, SearchHit } from './lib/types'

  type Mode = 'notes' | 'templates'

  let mode = $state<Mode>('notes')
  let notes = $state<SearchHit[]>([])
  let templates: NoteMeta[] = []
  let allNoteTitles: string[] = []
  let allNoteIndex = new Map<string, string>() // title -> id
  let current = $state<Note | null>(null)
  let saveTimer: number | null = null
  let dirty = $state(false)
  let editorEl: HTMLDivElement | undefined = $state()
  let editor: Editor | null = null
  let pendingDeleteId = $state<string | null>(null)
  let pendingDeleteTimer: number | null = null
  let searchQuery = $state('')
  let searchInput: HTMLInputElement | undefined = $state()
  let searchTimer: number | null = null

  setTemplatesProvider(
    () => templates.map((t) => ({ id: t.id, title: t.title })),
    (id) => api.loadTemplate(id),
  )

  setWikilinkContext(
    () => allNoteTitles,
    (title) => {
      const id = allNoteIndex.get(title)
      if (id) {
        if (mode !== 'notes') {
          void switchMode('notes').then(() => select(id))
        } else {
          void select(id)
        }
      }
    },
  )

  function scopeApi() {
    return mode === 'notes'
      ? {
          list: api.listNotes,
          load: api.loadNote,
          save: api.saveNote,
          create: api.createNote,
          del: api.deleteNote,
          search: api.searchNotes,
        }
      : {
          list: api.listTemplates,
          load: api.loadTemplate,
          save: api.saveTemplate,
          create: api.createTemplate,
          del: api.deleteTemplate,
          search: api.searchTemplates,
        }
  }

  async function refreshTemplates() {
    templates = await api.listTemplates()
  }

  async function refresh() {
    notes = await scopeApi().search(searchQuery)
    if (mode === 'templates') templates = notes
    else await refreshTemplates()
    const all = await api.listNotes()
    allNoteTitles = all.map((n) => n.title).filter(Boolean)
    allNoteIndex = new Map(
      all.filter((n) => n.title).map((n) => [n.title, n.id]),
    )
  }

  async function switchMode(next: Mode) {
    if (next === mode) return
    await flushSave()
    mode = next
    current = null
    searchQuery = ''
    clearPendingDelete()
    await refresh()
  }

  function debouncedSearch() {
    if (searchTimer !== null) clearTimeout(searchTimer)
    searchTimer = window.setTimeout(() => {
      searchTimer = null
      refresh()
    }, 120)
  }

  function clearSearch() {
    searchQuery = ''
    refresh()
    searchInput?.focus()
  }

  function highlight(text: string, q: string): Array<{ s: string; m: boolean }> {
    if (!q || !text) return [{ s: text, m: false }]
    const lower = text.toLowerCase()
    const lq = q.toLowerCase()
    const out: Array<{ s: string; m: boolean }> = []
    let i = 0
    while (i < text.length) {
      const idx = lower.indexOf(lq, i)
      if (idx < 0) {
        out.push({ s: text.slice(i), m: false })
        break
      }
      if (idx > i) out.push({ s: text.slice(i, idx), m: false })
      out.push({ s: text.slice(idx, idx + q.length), m: true })
      i = idx + q.length
    }
    return out
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

  async function openSettings() {
    config = await api.configGet()
    showSettings = true
  }

  async function changeVault() {
    const path = await api.pickFolder(config.vaultPath)
    if (!path) return
    await flushSave()
    config = await api.configSet({ vaultPath: path })
    current = null
    await refresh()
  }

  async function exportPDF() {
    if (!current || exporting) return
    await flushSave()
    const safeTitle = (current.title || 'untitled')
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim() || 'untitled'
    const filename = `${safeTitle}.pdf`

    exporting = true
    document.body.classList.add('exporting')
    // Let layout reflow before capture.
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    await new Promise((r) => requestAnimationFrame(() => r(null)))

    const done = new Promise<string>((resolve) => {
      const handler = (ev: Event) => {
        const detail = (ev as CustomEvent).detail
        window.removeEventListener('pdfexport', handler)
        resolve(detail?.status ?? 'unknown')
      }
      window.addEventListener('pdfexport', handler, { once: true })
    })

    try {
      await api.exportPDF(filename)
      await done
    } finally {
      document.body.classList.remove('exporting')
      exporting = false
    }
  }

  async function select(id: string) {
    await flushSave()
    if (current?.id === id) return
    current = await scopeApi().load(id)
    dirty = false
  }

  async function newNote() {
    await flushSave()
    const meta = await scopeApi().create()
    await refresh()
    current = await scopeApi().load(meta.id)
    dirty = false
  }

  function clearPendingDelete() {
    if (pendingDeleteTimer !== null) {
      clearTimeout(pendingDeleteTimer)
      pendingDeleteTimer = null
    }
    pendingDeleteId = null
  }

  async function remove(id: string, ev: Event) {
    ev.stopPropagation()
    if (pendingDeleteId === id) {
      clearPendingDelete()
      await scopeApi().del(id)
      if (current?.id === id) current = null
      await refresh()
      return
    }
    clearPendingDelete()
    pendingDeleteId = id
    pendingDeleteTimer = window.setTimeout(() => {
      pendingDeleteId = null
      pendingDeleteTimer = null
    }, 3000)
  }

  function scheduleSave() {
    dirty = true
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = window.setTimeout(flushSave, 500)
  }

  async function flushSave() {
    // Force any in-progress jspreadsheet cell editor to commit — but don't
    // blur the main TipTap contenteditable, since flushSave runs on every
    // debounced keystroke pause.
    const active = document.activeElement as HTMLElement | null
    if (active && active.closest('.spreadsheet-wrapper')) {
      active.blur()
      await Promise.resolve()
    }
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (!current || !dirty) return
    const { id, title, content } = current
    dirty = false
    await scopeApi().save(id, title, content)
    await refresh()
  }

  function formatDate(t: number) {
    const d = new Date(t)
    const now = new Date()
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  $effect(() => {
    if (!editorEl) return
    const initialContent = untrack(() => current?.content ?? '')
    const e = new Editor({
      element: editorEl,
      extensions: editorExtensions,
      content: initialContent,
      autofocus: false,
      onUpdate: ({ editor }) => {
        if (!current) return
        const md = (editor.storage as any).markdown.getMarkdown() as string
        if (md !== current.content) {
          current.content = md
          scheduleSave()
        }
      },
    })
    editor = e
    return () => {
      e.destroy()
      editor = null
    }
  })

  $effect(() => {
    window.addEventListener('keydown', onGlobalKeyDown)
    return () => window.removeEventListener('keydown', onGlobalKeyDown)
  })

  refresh()
</script>

<main>
  <aside>
    <header>
      <div class="tabs">
        <button
          class:active={mode === 'notes'}
          onclick={() => switchMode('notes')}>Notes</button>
        <button
          class:active={mode === 'templates'}
          onclick={() => switchMode('templates')}>Templates</button>
      </div>
      <button
        class="new"
        onclick={newNote}
        aria-label={mode === 'notes' ? 'New note' : 'New template'}>+</button>
      <button
        class="settings-btn"
        onclick={openSettings}
        aria-label="Settings"
        title="Settings">⚙</button>
    </header>
    <div class="search">
      <input
        bind:this={searchInput}
        bind:value={searchQuery}
        oninput={debouncedSearch}
        placeholder="Search… (⌘K)"
        type="search"
      />
      {#if searchQuery}
        <button class="search-clear" onclick={clearSearch} aria-label="Clear"
          >×</button
        >
      {/if}
    </div>
    <ul>
      {#each notes as note (note.id)}
        <li>
          <button
            class="row"
            class:active={current?.id === note.id}
            onclick={() => select(note.id)}
          >
            <div class="title">
              {#each highlight(note.title || 'Untitled', searchQuery) as seg}
                {#if seg.m}<mark>{seg.s}</mark>{:else}{seg.s}{/if}
              {/each}
            </div>
            {#if searchQuery && note.snippet}
              <div class="snippet">
                {#each highlight(note.snippet, searchQuery) as seg}
                  {#if seg.m}<mark>{seg.s}</mark>{:else}{seg.s}{/if}
                {/each}
              </div>
            {:else}
              <div class="meta">{formatDate(note.updatedAt)}</div>
            {/if}
          </button>
          <button
            class="del"
            class:pending={pendingDeleteId === note.id}
            onclick={(e) => remove(note.id, e)}
            aria-label={pendingDeleteId === note.id ? 'Confirm delete' : 'Delete'}
          >{pendingDeleteId === note.id ? '✓' : '×'}</button>
        </li>
      {/each}
      {#if notes.length === 0}
        <li class="empty-list">
          {searchQuery
            ? 'No matches'
            : mode === 'notes'
              ? 'No notes yet'
              : 'No templates yet'}
        </li>
      {/if}
    </ul>
  </aside>

  <section class="editor">
    {#if current}
      <input
        class="title-input"
        placeholder="Title"
        bind:value={current.title}
        oninput={scheduleSave}
      />
      {#key current.id}
        <div class="body" bind:this={editorEl}></div>
      {/key}
      <footer class="status">
        <button
          class="export-btn"
          onclick={exportPDF}
          disabled={exporting}
          onmousedown={(e) => e.preventDefault()}
          title="Export as PDF"
        >
          {exporting ? 'Exporting…' : 'Export PDF'}
        </button>
        <span class="status-text">{dirty ? 'Saving…' : 'Saved'}</span>
      </footer>
    {:else}
      <div class="empty">
        <p>
          {mode === 'notes'
            ? 'Select a note or create a new one'
            : 'Select a template, or create one to insert with /'}
        </p>
        <button class="new-big" onclick={newNote}
          >+ New {mode === 'notes' ? 'Note' : 'Template'}</button>
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
