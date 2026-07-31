<script lang="ts">
  // The current note's tag editor: chips (click to filter, × to remove) plus an
  // input that adds a tag on Enter/blur. Fully driven by the shared store; the
  // input and add/remove are hidden in archive mode (archived notes are frozen).
  import { store } from '../noteStore.svelte'
</script>

{#if store.current}
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
{/if}

<style>
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
</style>
