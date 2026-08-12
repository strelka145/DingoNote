<script lang="ts">
  // The left navigation pane: mode tabs (notes / templates / archive), the
  // new-item and settings buttons, search, the active-tag filter banner, and
  // the note list with per-row duplicate/restore/delete actions. Fully driven
  // by the shared store; opening Settings stays in App (it owns the dialog's
  // config state), so it comes in as a callback. Search — the input ref, the
  // clear button, and the ⌘K focus shortcut — is self-contained here.
  import { store } from '../noteStore.svelte'
  import { highlight } from '../highlight'

  let { onOpenSettings }: { onOpenSettings: () => void } = $props()

  let searchInput: HTMLInputElement | undefined = $state()

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

  $effect(() => {
    window.addEventListener('keydown', onGlobalKeyDown)
    return () => window.removeEventListener('keydown', onGlobalKeyDown)
  })
</script>

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
      onclick={onOpenSettings}
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

<style>
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

  .tag-filter {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-dim);
    padding: 4px 12px;
    margin: 0 8px;
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
  .tag-filter-clear {
    margin-left: auto;
    font-size: 14px;
    color: var(--text-dim);
    cursor: pointer;
  }
  .tag-filter-clear:hover {
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
</style>
