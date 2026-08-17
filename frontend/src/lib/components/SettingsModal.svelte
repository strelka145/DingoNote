<script lang="ts">
  // Settings dialog: vault location, a .gitignore helper, and the sidebar sort
  // order. `open` is bindable so the overlay/close button can dismiss it. The
  // vault path and its change action stay in App (the path also feeds image
  // resolution outside this dialog); the .gitignore helper is self-contained.
  import { api } from '../api'
  import { store } from '../noteStore.svelte'

  let {
    open = $bindable(),
    vaultPath,
    nativeFolderPicker,
    onChangeVault,
  }: {
    open: boolean
    vaultPath: string
    nativeFolderPicker: boolean
    onChangeVault: (path?: string) => void
  } = $props()

  let editingPath = $state(vaultPath)
  $effect(() => { editingPath = vaultPath })

  let gitignoreStatus = $state('')
  async function createGitignore() {
    gitignoreStatus = ''
    const { created } = await api.writeGitignore()
    gitignoreStatus = created
      ? '.gitignore created in the vault.'
      : '.gitignore already exists — left untouched.'
  }

  // Unused-image cleanup. Two steps: a scan (safe, read-only) reports how many
  // attachment files nothing references and their total size; a second click
  // deletes them. `confirm()` is a no-op in the webview, so the scan result
  // itself is the confirmation — the Delete button only appears after a scan
  // finds something. `orphans === null` means "not scanned yet / nothing found".
  const kb = (bytes: number) =>
    bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
  let orphans = $state<{ count: number; bytes: number } | null>(null)
  let attachmentStatus = $state('')
  let busy = $state(false)
  async function scanOrphans() {
    busy = true
    attachmentStatus = ''
    orphans = null
    const r = await api.attachmentsScanOrphans()
    busy = false
    if (r.count === 0) {
      attachmentStatus = 'No unused images found.'
    } else {
      orphans = r
    }
  }
  async function deleteOrphans() {
    busy = true
    const r = await api.attachmentsDeleteOrphans()
    busy = false
    orphans = null
    attachmentStatus = `Deleted ${r.deleted} unused image${
      r.deleted === 1 ? '' : 's'
    } (${kb(r.bytes)} freed).`
  }
</script>

{#if open}
  <div
    class="modal-overlay"
    onclick={() => (open = false)}
    role="presentation">
    <div
      class="modal"
      onclick={(e) => e.stopPropagation()}
      role="dialog">
      <header class="modal-header">
        <h2>Settings</h2>
        <button
          class="modal-close"
          onclick={() => (open = false)}
          aria-label="Close">×</button>
      </header>
      <div class="setting-row">
        <label>Vault Location</label>
        <div class="setting-control">
          {#if nativeFolderPicker}
            <code class="path">{vaultPath || '(default)'}</code>
            <button class="setting-btn" onclick={() => onChangeVault()}>Change…</button>
          {:else}
            <input
              class="path-input"
              type="text"
              bind:value={editingPath}
              placeholder="C:\Users\…"
            />
            <button
              class="setting-btn"
              onclick={() => onChangeVault(editingPath)}
              disabled={!editingPath || editingPath === vaultPath}
            >Apply</button>
          {/if}
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
        <label>Storage</label>
        <div class="setting-control">
          <button class="setting-btn" onclick={scanOrphans} disabled={busy}>
            Scan for unused images
          </button>
          {#if orphans}
            <button class="setting-btn danger" onclick={deleteOrphans} disabled={busy}>
              Delete {orphans.count} ({kb(orphans.bytes)})
            </button>
          {:else if attachmentStatus}
            <span class="hint inline">{attachmentStatus}</span>
          {/if}
        </div>
        <p class="hint">
          Finds image files in <code>attachments/</code> that no note, template,
          or archived note links to, and deletes them. Deletion is permanent —
          scan first to see what would go.
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
  .path-input {
    flex: 1;
    padding: 6px 10px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--text);
  }
  .path-input:focus {
    outline: none;
    border-color: var(--accent);
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
  .setting-btn:disabled {
    opacity: 0.5;
    cursor: default;
    filter: none;
  }
  .setting-btn.danger {
    background: var(--danger);
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
</style>
