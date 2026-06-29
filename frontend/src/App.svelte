<script lang="ts">
  import { untrack } from 'svelte'
  import { Editor } from '@tiptap/core'
  import {
    editorExtensions,
    setTemplatesProvider,
    setWikilinkContext,
    setVaultPathProvider,
    commitAllSpreadsheets,
  } from './lib/editor'
  import { api } from './lib/api'
  import type { Note, NoteMeta, SearchHit } from './lib/types'

  type Mode = 'notes' | 'templates' | 'archive'

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
  let inTable = $state(false)
  let pendingDeleteId = $state<string | null>(null)
  let pendingDeleteTimer: number | null = null
  let searchQuery = $state('')
  let searchInput: HTMLInputElement | undefined = $state()
  let searchTimer: number | null = null
  let activeTag = $state<string | null>(null)
  let tagDraft = $state('')

  type SortKey = 'updated-desc' | 'updated-asc' | 'title-asc' | 'title-desc'
  const SORT_KEYS: ReadonlyArray<SortKey> = [
    'updated-desc',
    'updated-asc',
    'title-asc',
    'title-desc',
  ]
  function loadSortPref(): SortKey {
    const v = localStorage.getItem('notes-sort') as SortKey | null
    return v && SORT_KEYS.includes(v) ? v : 'updated-desc'
  }
  let sortBy = $state<SortKey>(loadSortPref())
  $effect(() => {
    localStorage.setItem('notes-sort', sortBy)
  })

  const sortedNotes = $derived.by(() => {
    let list = notes.slice()
    if (activeTag) {
      list = list.filter((n) => (n.tags ?? []).includes(activeTag!))
    }
    const t = (n: SearchHit) => (n.title || '').toLowerCase()
    list.sort((a, b) => {
      switch (sortBy) {
        case 'updated-desc':
          return b.updatedAt - a.updatedAt
        case 'updated-asc':
          return a.updatedAt - b.updatedAt
        case 'title-asc':
          return t(a).localeCompare(t(b))
        case 'title-desc':
          return t(b).localeCompare(t(a))
      }
    })
    return list
  })

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
    if (mode === 'notes') {
      return {
        list: api.listNotes,
        load: api.loadNote,
        save: api.saveNote,
        create: api.createNote,
        del: api.deleteNote,
        duplicate: api.duplicateNote,
        search: api.searchNotes,
      }
    }
    if (mode === 'templates') {
      return {
        list: api.listTemplates,
        load: api.loadTemplate,
        save: api.saveTemplate,
        create: api.createTemplate,
        del: api.deleteTemplate,
        duplicate: api.duplicateTemplate,
        search: api.searchTemplates,
      }
    }
    // archive — purge as delete, no save/create/duplicate
    return {
      list: api.listArchive,
      load: api.loadArchive,
      save: async () => {},
      create: async () => {
        throw new Error('Cannot create in archive')
      },
      del: api.purgeArchive,
      duplicate: async (_id: string) => {
        throw new Error('Cannot duplicate in archive')
      },
      search: api.searchArchive,
    }
  }

  async function duplicate(id: string, ev: Event) {
    ev.stopPropagation()
    clearPendingDelete()
    await flushSave()
    await commitWikilinkRename()
    const meta = await scopeApi().duplicate(id)
    await refresh()
    current = await scopeApi().load(meta.id)
    loadedTitle = current?.title ?? null
    dirty = false
  }

  async function restoreFromArchive(id: string, ev: Event) {
    ev.stopPropagation()
    clearPendingDelete()
    await api.restoreNote(id)
    if (current?.id === id) current = null
    await refresh()
  }

  // ── Wikilink rename cascade ────────────────────────────────────────────────
  // Tracks the current note's title at load time so we can detect renames
  // and rewrite `[[old]]` → `[[new]]` across the vault.
  let loadedTitle: string | null = null

  async function commitWikilinkRename() {
    if (!current || loadedTitle === null) return
    if (mode === 'archive') return // archived notes are frozen
    const oldT = loadedTitle
    const newT = current.title
    if (!oldT || !newT || oldT === newT) {
      loadedTitle = newT
      return
    }
    try {
      await api.renameWikilinks(oldT, newT)
    } catch {}
    loadedTitle = newT
  }

  function addTag(raw: string) {
    if (!current) return
    const tag = raw.trim().replace(/^#+/, '').replace(/\s+/g, '-')
    if (!tag) return
    const tags = current.tags ?? []
    if (!tags.includes(tag)) {
      current.tags = [...tags, tag]
      scheduleSave()
    }
  }

  function removeTag(tag: string) {
    if (!current) return
    current.tags = (current.tags ?? []).filter((t) => t !== tag)
    scheduleSave()
  }

  function onTagKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault()
      addTag(tagDraft)
      tagDraft = ''
    } else if (e.key === 'Backspace' && tagDraft === '') {
      const tags = current?.tags ?? []
      if (tags.length) removeTag(tags[tags.length - 1])
    }
  }

  function filterByTag(tag: string) {
    activeTag = activeTag === tag ? null : tag
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
    await commitWikilinkRename()
    loadedTitle = null
    mode = next
    current = null
    searchQuery = ''
    activeTag = null
    tagDraft = ''
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
    await flushSave()
    config = await api.configSet({ vaultPath: path })
    current = null
    await refresh()
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
    if (!current || exporting) return
    await flushSave()
    const safeTitle = (current.title || 'untitled')
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim() || 'untitled'
    const filename = `${safeTitle}.pdf`

    exporting = true
    document.body.classList.add('exporting')
    // Let layout reflow (body.exporting narrows #app to print width)
    // before measurement / capture.
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    await new Promise((r) => requestAnimationFrame(() => r(null)))

    // Per-spreadsheet shrink: text reflows at the print column width
    // naturally, but jspreadsheet tables don't reflow. For each wider
    // sheet, apply `zoom` so only that sheet is scaled down, leaving
    // text and other content at their natural print size.
    const restoreFns: Array<() => void> = []
    const editorBody = document.querySelector<HTMLElement>('.body')
    if (editorBody) {
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
    }
    if (restoreFns.length) {
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      await new Promise((r) => requestAnimationFrame(() => r(null)))
    }

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
      restoreFns.forEach((fn) => fn())
      document.body.classList.remove('exporting')
      exporting = false
    }
  }

  async function select(id: string) {
    await flushSave()
    await commitWikilinkRename()
    if (current?.id === id) return
    current = await scopeApi().load(id)
    loadedTitle = current?.title ?? null
    dirty = false
  }

  async function newNote() {
    await flushSave()
    await commitWikilinkRename()
    const meta = await scopeApi().create()
    await refresh()
    current = await scopeApi().load(meta.id)
    loadedTitle = current?.title ?? null
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
    // Synchronously push any pending spreadsheet cell edits into the document
    // before reading current.content. Spreadsheet edits reach the doc via an
    // async microtask flush; on a note switch, focus has already left the grid
    // (so the old activeElement-based blur check was skipped) and the save
    // would read stale content and drop the edit. commitAllSpreadsheets fires
    // onUpdate synchronously, so current.content + dirty are current here.
    commitAllSpreadsheets()
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (!current || !dirty) return
    const { id, title, tags, content } = current
    dirty = false
    await scopeApi().save(id, title, tags ?? [], content)
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
    const isReadOnly = untrack(() => mode === 'archive')
    const e = new Editor({
      element: editorEl,
      extensions: editorExtensions,
      content: initialContent,
      autofocus: false,
      editable: !isReadOnly,
      // Wider safety zone around the caret before ProseMirror's
      // scrollIntoView fires — reduces oscillation when typing near
      // the viewport edges.
      editorProps: {
        scrollMargin: 80,
        scrollThreshold: 80,
        // Excel / Google Sheets emit tables with only <td> (no <thead> or
        // <th>), so TipTap treats every row as a data row and the table
        // ends up headerless. Promote the first row's cells to <th> when
        // none are present so pasted tables keep a sensible header.
        transformPastedHTML(html) {
          if (!html || !/<table\b/i.test(html)) return html
          try {
            const doc = new DOMParser().parseFromString(html, 'text/html')
            doc.querySelectorAll('table').forEach((table) => {
              if (table.querySelector('th')) return
              const firstRow = table.querySelector('tr')
              if (!firstRow) return
              firstRow.querySelectorAll('td').forEach((td) => {
                const th = doc.createElement('th')
                th.innerHTML = td.innerHTML
                for (const attr of Array.from(td.attributes)) {
                  th.setAttribute(attr.name, attr.value)
                }
                td.replaceWith(th)
              })
            })
            return doc.body.innerHTML
          } catch {
            return html
          }
        },
      },
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

  loadConfig().then(() => refresh())
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
        <button
          class:active={mode === 'archive'}
          onclick={() => switchMode('archive')}
          title="Archive — soft-deleted notes">🗑</button>
      </div>
      {#if mode !== 'archive'}
        <button
          class="new"
          onclick={newNote}
          aria-label={mode === 'notes' ? 'New note' : 'New template'}>+</button>
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
    {#if activeTag}
      <div class="tag-filter">
        Filtered by <span class="tag-label active">#{activeTag}</span>
        <button class="tag-filter-clear" onclick={() => (activeTag = null)}
          >×</button
        >
      </div>
    {/if}
    <ul>
      {#each sortedNotes as note (note.id)}
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
            {#if note.tags?.length}
              <div class="row-tags">
                {#each note.tags as tag}
                  <span class="row-tag" class:active={activeTag === tag}
                    >#{tag}</span
                  >
                {/each}
              </div>
            {/if}
          </button>
          {#if mode === 'archive'}
            <button
              class="restore"
              onclick={(e) => restoreFromArchive(note.id, e)}
              aria-label="Restore"
              title="Restore to Notes">↺</button>
          {:else}
            <button
              class="dup"
              onclick={(e) => duplicate(note.id, e)}
              aria-label="Duplicate"
              title="Duplicate">⎘</button>
          {/if}
          <button
            class="del"
            class:pending={pendingDeleteId === note.id}
            onclick={(e) => remove(note.id, e)}
            aria-label={pendingDeleteId === note.id
              ? mode === 'archive' ? 'Confirm permanent delete' : 'Confirm delete'
              : mode === 'archive' ? 'Delete forever' : 'Delete'}
            title={mode === 'archive'
              ? (pendingDeleteId === note.id ? 'Delete forever — click again to confirm' : 'Delete forever')
              : (pendingDeleteId === note.id ? 'Click again to confirm' : 'Move to archive')}
          >{pendingDeleteId === note.id ? '✓' : '×'}</button>
        </li>
      {/each}
      {#if notes.length === 0}
        <li class="empty-list">
          {searchQuery
            ? 'No matches'
            : mode === 'notes'
              ? 'No notes yet'
              : mode === 'templates'
                ? 'No templates yet'
                : 'Archive is empty'}
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
      <div class="tags-bar">
        {#each current.tags ?? [] as tag (tag)}
          <span class="tag-chip">
            <button
              class="tag-label"
              onclick={() => filterByTag(tag)}
              class:active={activeTag === tag}
              title="Filter by #{tag}">#{tag}</button
            >
            {#if mode !== 'archive'}
              <button
                class="tag-x"
                onclick={() => removeTag(tag)}
                aria-label="Remove tag #{tag}">×</button
              >
            {/if}
          </span>
        {/each}
        {#if mode !== 'archive'}
          <input
            class="tag-input"
            placeholder="add tag…"
            bind:value={tagDraft}
            onkeydown={onTagKeydown}
            onblur={() => {
              if (tagDraft.trim()) {
                addTag(tagDraft)
                tagDraft = ''
              }
            }}
          />
        {/if}
      </div>
      {#key current.id}
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
          {#if mode === 'archive'}
            Archived (read-only)
          {:else if dirty}
            Saving…
          {:else}
            Saved
          {/if}
        </span>
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
            bind:value={sortBy}
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
