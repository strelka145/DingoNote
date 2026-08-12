import type { AppConfig, Note, NoteMeta, SearchHit } from './types'
import type { NoteApi } from './api'

// localStorage implementation of NoteApi — used when the Nim backend isn't
// present (plain browser dev/preview). Notes, templates, and archive each live
// under their own key; everything else is best-effort (no native picker, no PDF,
// no attachments on disk).

const WEB_CONFIG = {
  platform: 'web',
  features: { pdfExport: false, nativeFolderPicker: false },
} as const

export function localApi(): NoteApi {
  type Store = Record<string, Note>
  const makeScope = (key: string) => {
    const load = (): Store => JSON.parse(localStorage.getItem(key) ?? '{}')
    const persist = (s: Store) => localStorage.setItem(key, JSON.stringify(s))
    return { load, persist }
  }
  const notes = makeScope('note-app-data')
  const templates = makeScope('note-app-templates')
  const archive = makeScope('note-app-archive')

  const search = (s: Store, query: string): SearchHit[] => {
    const q = query.trim().toLowerCase()
    const hits: SearchHit[] = []
    for (const n of Object.values(s)) {
      if (q.length === 0) {
        hits.push({
          id: n.id,
          title: n.title,
          tags: n.tags ?? [],
          updatedAt: n.updatedAt,
          snippet: '',
        })
        continue
      }
      const titleMatch = n.title.toLowerCase().includes(q)
      const bodyMatch = n.content.toLowerCase().includes(q)
      const tagMatch = (n.tags ?? []).some((t) => t.toLowerCase().includes(q))
      if (!titleMatch && !bodyMatch && !tagMatch) continue
      let snippet = n.title
      if (bodyMatch) {
        const idx = n.content.toLowerCase().indexOf(q)
        const start = Math.max(0, idx - 60)
        const end = Math.min(n.content.length, idx + q.length + 60)
        snippet =
          (start > 0 ? '…' : '') +
          n.content.slice(start, end).replace(/\s+/g, ' ').trim() +
          (end < n.content.length ? '…' : '')
      }
      hits.push({
        id: n.id,
        title: n.title,
        tags: n.tags ?? [],
        updatedAt: n.updatedAt,
        snippet,
      })
    }
    hits.sort((a, b) => b.updatedAt - a.updatedAt)
    return hits
  }

  const load = notes.load
  const persist = notes.persist
  return {
    async listNotes() {
      return Object.values(load())
        .map((n) => ({
          id: n.id,
          title: n.title,
          tags: n.tags ?? [],
          updatedAt: n.updatedAt,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt)
    },
    async loadNote(id) {
      return load()[id] ?? null
    },
    async saveNote(id, title, tags, content) {
      const s = load()
      s[id] = { id, title, tags, content, updatedAt: Date.now() }
      persist(s)
    },
    async createNote() {
      const id = crypto.randomUUID()
      const note: Note = {
        id,
        title: '',
        tags: [],
        content: '',
        updatedAt: Date.now(),
      }
      const s = load()
      s[id] = note
      persist(s)
      return {
        id: note.id,
        title: note.title,
        tags: note.tags,
        updatedAt: note.updatedAt,
      }
    },
    async deleteNote(id) {
      const s = load()
      const note = s[id]
      if (!note) return
      delete s[id]
      persist(s)
      // Move to archive (soft delete)
      const a = archive.load()
      a[id] = { ...note, updatedAt: Date.now() }
      archive.persist(a)
    },
    async duplicateNote(id) {
      const s = load()
      const src = s[id]
      if (!src) throw new Error('Source not found')
      const newId = crypto.randomUUID()
      const newTitle = src.title ? `${src.title} (copy)` : ''
      const note: Note = {
        id: newId,
        title: newTitle,
        tags: src.tags ?? [],
        content: src.content,
        updatedAt: Date.now(),
      }
      s[newId] = note
      persist(s)
      return {
        id: newId,
        title: newTitle,
        tags: note.tags,
        updatedAt: note.updatedAt,
      }
    },
    async renameWikilinks(oldTitle, newTitle) {
      if (!oldTitle || !newTitle || oldTitle === newTitle) return 0
      const oldRef = `[[${oldTitle}]]`
      const newRef = `[[${newTitle}]]`
      let count = 0
      for (const scope of [notes, templates]) {
        const s = scope.load() as Store
        let changed = false
        for (const id of Object.keys(s)) {
          if (!s[id].content.includes(oldRef)) continue
          s[id] = { ...s[id], content: s[id].content.split(oldRef).join(newRef) }
          changed = true
          count++
        }
        if (changed) scope.persist(s)
      }
      return count
    },
    async searchNotes(query) {
      return search(load(), query)
    },
    async listTemplates() {
      return Object.values(templates.load())
        .map((n) => ({
          id: n.id,
          title: n.title,
          tags: n.tags ?? [],
          updatedAt: n.updatedAt,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt)
    },
    async loadTemplate(id) {
      return templates.load()[id] ?? null
    },
    async saveTemplate(id, title, tags, content) {
      const s = templates.load()
      s[id] = { id, title, tags, content, updatedAt: Date.now() }
      templates.persist(s)
    },
    async createTemplate() {
      const id = crypto.randomUUID()
      const note: Note = {
        id,
        title: '',
        tags: [],
        content: '',
        updatedAt: Date.now(),
      }
      const s = templates.load()
      s[id] = note
      templates.persist(s)
      return {
        id: note.id,
        title: note.title,
        tags: note.tags,
        updatedAt: note.updatedAt,
      }
    },
    async deleteTemplate(id) {
      const s = templates.load()
      delete s[id]
      templates.persist(s)
    },
    async duplicateTemplate(id) {
      const s = templates.load()
      const src = s[id]
      if (!src) throw new Error('Source not found')
      const newId = crypto.randomUUID()
      const newTitle = src.title ? `${src.title} (copy)` : ''
      const note: Note = {
        id: newId,
        title: newTitle,
        tags: src.tags ?? [],
        content: src.content,
        updatedAt: Date.now(),
      }
      s[newId] = note
      templates.persist(s)
      return {
        id: newId,
        title: newTitle,
        tags: note.tags,
        updatedAt: note.updatedAt,
      }
    },
    async searchTemplates(query) {
      return search(templates.load(), query)
    },
    async listArchive() {
      return Object.values(archive.load())
        .map((n) => ({
          id: n.id,
          title: n.title,
          tags: n.tags ?? [],
          updatedAt: n.updatedAt,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt)
    },
    async loadArchive(id) {
      return archive.load()[id] ?? null
    },
    async searchArchive(query) {
      return search(archive.load(), query)
    },
    async restoreNote(id) {
      const a = archive.load()
      const note = a[id]
      if (!note) return
      delete a[id]
      archive.persist(a)
      const s = load()
      s[id] = { ...note, updatedAt: Date.now() }
      persist(s)
    },
    async purgeArchive(id) {
      const a = archive.load()
      delete a[id]
      archive.persist(a)
    },
    async exportPDF() {
      window.print()
    },
    async configGet(): Promise<AppConfig> {
      const raw = localStorage.getItem('note-app-config')
      const stored = raw ? (JSON.parse(raw) as { vaultPath?: string }) : {}
      return { vaultPath: stored.vaultPath ?? '~/Documents/Note', ...WEB_CONFIG }
    },
    async configSet(c): Promise<AppConfig> {
      const cur = await this.configGet()
      const next: AppConfig = { ...cur, ...c }
      // Persist only the vault path; platform/features are derived, not stored.
      localStorage.setItem(
        'note-app-config',
        JSON.stringify({ vaultPath: next.vaultPath }),
      )
      return next
    },
    async pickFolder() {
      // No native picker in the browser; a text prompt is the fallback. Returns
      // null when the user cancels — same contract as the native backend.
      return prompt('Vault path:')
    },
    async writeGitignore() {
      return { created: false, path: '' }
    },
    async saveAttachment(url) {
      return url
    },
  }
}
