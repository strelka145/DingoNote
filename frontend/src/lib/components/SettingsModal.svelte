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
    onChangeVault,
  }: {
    open: boolean
    vaultPath: string
    onChangeVault: () => void
  } = $props()

  let gitignoreStatus = $state('')
  async function createGitignore() {
    gitignoreStatus = ''
    const { created } = await api.writeGitignore()
    gitignoreStatus = created
      ? '.gitignore created in the vault.'
      : '.gitignore already exists — left untouched.'
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
          <code class="path">{vaultPath || '(default)'}</code>
          <button class="setting-btn" onclick={onChangeVault}>Change…</button>
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
