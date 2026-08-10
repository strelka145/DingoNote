import type { Editor } from '@tiptap/core'
import { api } from './api'
import { commitAllSpreadsheets } from './editor'
import type { Note, NoteMeta, SearchHit } from './types'

export type Mode = 'notes' | 'templates' | 'archive'
export type SortKey =
  | 'updated-desc'
  | 'updated-asc'
  | 'title-asc'
  | 'title-desc'

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

// Owns the note/template/archive data and every operation that touches it —
// listing, searching, loading, saving, and the wikilink-rename cascade. The
// DOM refs, PDF export, and settings live in App.svelte, which drives this
// store. Exported as a singleton so the sidebar / tag / and settings components
// read the same reactive state without prop threading.
class NoteStore {
  mode = $state<Mode>('notes')
  notes = $state<SearchHit[]>([])
  templates: NoteMeta[] = []
  allNoteTitles: string[] = []
  allNoteIndex = new Map<string, string>() // title -> id
  current = $state<Note | null>(null)
  // The live editor, set by App.svelte on create and cleared on destroy. The
  // store needs it only to flush pending spreadsheet edits before saving
  // (commitAllSpreadsheets); it is not reactive.
  editor: Editor | null = null
  // Single source of truth for save status. 'unsaved' / 'error' both mean the
  // current document has edits not yet persisted (so flushSave has work to do);
  // 'saved' / 'saving' mean nothing new is pending. Footer and chip both read it.
  saveState = $state<'saved' | 'unsaved' | 'saving' | 'error'>('saved')
  saveError = $state('')
  pendingDeleteId = $state<string | null>(null)
  searchQuery = $state('')
  activeTag = $state<string | null>(null)
  tagDraft = $state('')
  sortBy = $state<SortKey>(loadSortPref())

  private saveTimer: number | null = null
  private pendingDeleteTimer: number | null = null
  private searchTimer: number | null = null
  // Tracks the current note's title at load time so we can detect renames and
  // rewrite `[[old]]` → `[[new]]` across the vault.
  private loadedTitle: string | null = null
  // Monotonic guard: fast typing fires overlapping refresh()es, and a slower
  // earlier request could resolve after a newer one. Each call claims a seq and
  // bails after every await if a newer refresh has since started, so stale
  // responses never overwrite the current results.
  private refreshSeq = 0

  sortedNotes = $derived.by(() => {
    let list = this.notes.slice()
    if (this.activeTag) {
      list = list.filter((n) => (n.tags ?? []).includes(this.activeTag!))
    }
    const t = (n: SearchHit) => (n.title || '').toLowerCase()
    list.sort((a, b) => {
      switch (this.sortBy) {
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

  private scopeApi() {
    if (this.mode === 'notes') {
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
    if (this.mode === 'templates') {
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

  refreshTemplates = async () => {
    this.templates = await api.listTemplates()
  }

  refresh = async () => {
    const seq = ++this.refreshSeq
    const hits = await this.scopeApi().search(this.searchQuery)
    if (seq !== this.refreshSeq) return
    this.notes = hits
    if (this.mode === 'templates') {
      this.templates = this.notes
    } else {
      await this.refreshTemplates()
      if (seq !== this.refreshSeq) return
    }
    const all = await api.listNotes()
    if (seq !== this.refreshSeq) return
    this.allNoteTitles = all.map((n) => n.title).filter(Boolean)
    this.allNoteIndex = new Map(
      all.filter((n) => n.title).map((n) => [n.title, n.id]),
    )
  }

  switchMode = async (next: Mode) => {
    if (next === this.mode) return
    if (!(await this.flushSave())) return
    await this.commitWikilinkRename()
    this.loadedTitle = null
    this.mode = next
    this.current = null
    this.searchQuery = ''
    this.activeTag = null
    this.tagDraft = ''
    this.clearPendingDelete()
    await this.refresh()
  }

  debouncedSearch = () => {
    if (this.searchTimer !== null) clearTimeout(this.searchTimer)
    this.searchTimer = window.setTimeout(() => {
      this.searchTimer = null
      this.refresh()
    }, 120)
  }

  clearSearch = () => {
    this.searchQuery = ''
    this.refresh()
  }

  // ── Wikilink rename cascade ────────────────────────────────────────────────
  commitWikilinkRename = async () => {
    if (!this.current || this.loadedTitle === null) return
    if (this.mode === 'archive') return // archived notes are frozen
    const oldT = this.loadedTitle
    const newT = this.current.title
    if (!oldT || !newT || oldT === newT) {
      this.loadedTitle = newT
      return
    }
    try {
      await api.renameWikilinks(oldT, newT)
    } catch (e) {
      // Non-fatal: the note itself was already saved; only the backlink rename
      // failed. Surface it rather than swallowing silently.
      console.warn('renameWikilinks failed', e)
    }
    this.loadedTitle = newT
  }

  // ── Tags ───────────────────────────────────────────────────────────────────
  addTag = (raw: string) => {
    if (!this.current) return
    const tag = raw.trim().replace(/^#+/, '').replace(/\s+/g, '-')
    if (!tag) return
    const tags = this.current.tags ?? []
    if (!tags.includes(tag)) {
      this.current.tags = [...tags, tag]
      this.scheduleSave()
    }
  }

  removeTag = (tag: string) => {
    if (!this.current) return
    this.current.tags = (this.current.tags ?? []).filter((t) => t !== tag)
    this.scheduleSave()
  }

  onTagKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault()
      this.addTag(this.tagDraft)
      this.tagDraft = ''
    } else if (e.key === 'Backspace' && this.tagDraft === '') {
      const tags = this.current?.tags ?? []
      if (tags.length) this.removeTag(tags[tags.length - 1])
    }
  }

  filterByTag = (tag: string) => {
    this.activeTag = this.activeTag === tag ? null : tag
  }

  // ── Loading / navigation ─────────────────────────────────────────────────
  // Load a note/template/archive entry into the editor and reset the save/title
  // tracking — a freshly loaded note is by definition saved. Shared by select /
  // newNote / duplicate; callers own the preceding flush + rename and any
  // refresh. Resetting saveState here is what keeps newNote/duplicate from
  // leaving a stale 'unsaved'/'error' chip behind.
  openNote = async (id: string) => {
    this.current = await this.scopeApi().load(id)
    this.loadedTitle = this.current?.title ?? null
    this.saveState = 'saved'
  }

  select = async (id: string) => {
    if (!(await this.flushSave())) return
    await this.commitWikilinkRename()
    if (this.current?.id === id) return
    await this.openNote(id)
  }

  newNote = async () => {
    if (!(await this.flushSave())) return
    await this.commitWikilinkRename()
    const meta = await this.scopeApi().create()
    await this.refresh()
    await this.openNote(meta.id)
  }

  duplicate = async (id: string, ev: Event) => {
    ev.stopPropagation()
    this.clearPendingDelete()
    if (!(await this.flushSave())) return
    await this.commitWikilinkRename()
    const meta = await this.scopeApi().duplicate(id)
    await this.refresh()
    await this.openNote(meta.id)
  }

  restoreFromArchive = async (id: string, ev: Event) => {
    ev.stopPropagation()
    this.clearPendingDelete()
    await api.restoreNote(id)
    if (this.current?.id === id) this.current = null
    await this.refresh()
  }

  clearPendingDelete = () => {
    if (this.pendingDeleteTimer !== null) {
      clearTimeout(this.pendingDeleteTimer)
      this.pendingDeleteTimer = null
    }
    this.pendingDeleteId = null
  }

  remove = async (id: string, ev: Event) => {
    ev.stopPropagation()
    if (this.pendingDeleteId === id) {
      this.clearPendingDelete()
      await this.scopeApi().del(id)
      if (this.current?.id === id) this.current = null
      await this.refresh()
      return
    }
    this.clearPendingDelete()
    this.pendingDeleteId = id
    this.pendingDeleteTimer = window.setTimeout(() => {
      this.pendingDeleteId = null
      this.pendingDeleteTimer = null
    }, 3000)
  }

  // ── Saving ─────────────────────────────────────────────────────────────────
  scheduleSave = () => {
    this.saveState = 'unsaved'
    if (this.saveTimer !== null) clearTimeout(this.saveTimer)
    this.saveTimer = window.setTimeout(this.flushSave, 500)
  }

  // Re-serialize the document and, if it changed, mark unsaved + schedule a save.
  // Called both from TipTap's onUpdate and explicitly from the spreadsheet
  // commit listener — a setNodeAttribute flush from a spreadsheet edit doesn't
  // reliably fire onUpdate, so without the explicit call a spreadsheet-only
  // edit updates the doc but never triggers a save.
  syncFromEditor = (ed: Editor) => {
    if (!this.current) return
    const md = (ed.storage as any).markdown.getMarkdown() as string
    if (md !== this.current.content) {
      this.current.content = md
      this.scheduleSave()
    }
  }

  // Returns true when it's safe to proceed (nothing to save, or the save
  // succeeded); false when the save failed and the caller must not switch away.
  flushSave = async (): Promise<boolean> => {
    // Synchronously push any pending spreadsheet cell edits into the document
    // before reading current.content. Spreadsheet edits reach the doc via an
    // async microtask flush; on a note switch, focus has already left the grid
    // (so the old activeElement-based blur check was skipped) and the save
    // would read stale content and drop the edit. commitAllSpreadsheets fires
    // onUpdate synchronously, so current.content + saveState are current here.
    commitAllSpreadsheets(this.editor)
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    // Nothing to persist unless the document has pending edits ('unsaved') or a
    // prior save failed and still needs retrying ('error').
    if (!this.current || (this.saveState !== 'unsaved' && this.saveState !== 'error'))
      return true
    const { id, title, tags, content } = this.current
    this.saveState = 'saving'
    this.saveError = ''
    try {
      await this.scopeApi().save(id, title, tags ?? [], content)
      // Only settle to 'saved' if no edit landed mid-save; scheduleSave would
      // have flipped us back to 'unsaved' (with a fresh timer to persist it).
      if (this.saveState === 'saving') this.saveState = 'saved'
    } catch (e) {
      // Surface the error and stay dirty; callers must NOT proceed to switch
      // notes, or the unsaved content would be silently discarded.
      this.saveState = 'error'
      this.saveError = e instanceof Error ? e.message : String(e)
      return false
    }
    await this.refresh()
    return true
  }

  formatDate(t: number) {
    const d = new Date(t)
    const now = new Date()
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }
}

export const store = new NoteStore()
