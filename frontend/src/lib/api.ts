import type { Note, NoteMeta, SearchHit } from './types'

interface NoteApi {
  listNotes(): Promise<NoteMeta[]>
  loadNote(id: string): Promise<Note | null>
  saveNote(id: string, title: string, content: string): Promise<void>
  createNote(): Promise<NoteMeta>
  deleteNote(id: string): Promise<void>
  duplicateNote(id: string): Promise<NoteMeta>
  renameWikilinks(oldTitle: string, newTitle: string): Promise<number>
  searchNotes(query: string): Promise<SearchHit[]>
  listTemplates(): Promise<NoteMeta[]>
  loadTemplate(id: string): Promise<Note | null>
  saveTemplate(id: string, title: string, content: string): Promise<void>
  createTemplate(): Promise<NoteMeta>
  deleteTemplate(id: string): Promise<void>
  duplicateTemplate(id: string): Promise<NoteMeta>
  searchTemplates(query: string): Promise<SearchHit[]>
  listArchive(): Promise<NoteMeta[]>
  loadArchive(id: string): Promise<Note | null>
  searchArchive(query: string): Promise<SearchHit[]>
  restoreNote(id: string): Promise<void>
  purgeArchive(id: string): Promise<void>
  exportPDF(filename: string): Promise<void>
  configGet(): Promise<{ vaultPath: string }>
  configSet(config: { vaultPath?: string }): Promise<{ vaultPath: string }>
  pickFolder(startPath?: string): Promise<string>
  saveAttachment(dataUrl: string): Promise<string>
}

declare global {
  interface Window {
    noteList?: () => Promise<NoteMeta[]>
    noteLoad?: (id: string) => Promise<Note | null>
    noteSave?: (id: string, title: string, content: string) => Promise<void>
    noteCreate?: () => Promise<NoteMeta>
    noteDelete?: (id: string) => Promise<void>
    noteDuplicate?: (id: string) => Promise<NoteMeta>
    renameWikilinks?: (oldTitle: string, newTitle: string) => Promise<number>
    noteSearch?: (query: string) => Promise<SearchHit[]>
    templateList?: () => Promise<NoteMeta[]>
    templateLoad?: (id: string) => Promise<Note | null>
    templateSave?: (id: string, title: string, content: string) => Promise<void>
    templateCreate?: () => Promise<NoteMeta>
    templateDelete?: (id: string) => Promise<void>
    templateDuplicate?: (id: string) => Promise<NoteMeta>
    templateSearch?: (query: string) => Promise<SearchHit[]>
    archiveList?: () => Promise<NoteMeta[]>
    archiveLoad?: (id: string) => Promise<Note | null>
    archiveSearch?: (query: string) => Promise<SearchHit[]>
    archiveRestore?: (id: string) => Promise<void>
    archivePurge?: (id: string) => Promise<void>
    exportPDF?: (filename: string) => Promise<void>
    configGet?: () => Promise<{ vaultPath: string }>
    configSet?: (
      config: { vaultPath?: string },
    ) => Promise<{ vaultPath: string }>
    pickFolder?: (startPath?: string) => Promise<string>
    saveAttachment?: (dataUrl: string) => Promise<string>
  }
}

function nimApi(): NoteApi {
  return {
    listNotes: () => window.noteList!(),
    loadNote: (id) => window.noteLoad!(id),
    saveNote: (id, title, content) => window.noteSave!(id, title, content),
    createNote: () => window.noteCreate!(),
    deleteNote: (id) => window.noteDelete!(id),
    duplicateNote: (id) => window.noteDuplicate!(id),
    renameWikilinks: (o, n) => window.renameWikilinks!(o, n),
    searchNotes: (query) => window.noteSearch!(query),
    listTemplates: () => window.templateList!(),
    loadTemplate: (id) => window.templateLoad!(id),
    saveTemplate: (id, title, content) =>
      window.templateSave!(id, title, content),
    createTemplate: () => window.templateCreate!(),
    deleteTemplate: (id) => window.templateDelete!(id),
    duplicateTemplate: (id) => window.templateDuplicate!(id),
    searchTemplates: (query) => window.templateSearch!(query),
    listArchive: () => window.archiveList!(),
    loadArchive: (id) => window.archiveLoad!(id),
    searchArchive: (query) => window.archiveSearch!(query),
    restoreNote: (id) => window.archiveRestore!(id),
    purgeArchive: (id) => window.archivePurge!(id),
    exportPDF: (filename) => window.exportPDF!(filename),
    configGet: () => window.configGet!(),
    configSet: (c) => window.configSet!(c),
    pickFolder: (s) => window.pickFolder!(s ?? ''),
    saveAttachment: (url) => window.saveAttachment!(url),
  }
}

function localApi(): NoteApi {
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
          updatedAt: n.updatedAt,
          snippet: '',
        })
        continue
      }
      const titleMatch = n.title.toLowerCase().includes(q)
      const bodyMatch = n.content.toLowerCase().includes(q)
      if (!titleMatch && !bodyMatch) continue
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
        .map((n) => ({ id: n.id, title: n.title, updatedAt: n.updatedAt }))
        .sort((a, b) => b.updatedAt - a.updatedAt)
    },
    async loadNote(id) {
      return load()[id] ?? null
    },
    async saveNote(id, title, content) {
      const s = load()
      s[id] = { id, title, content, updatedAt: Date.now() }
      persist(s)
    },
    async createNote() {
      const id = crypto.randomUUID()
      const note: Note = { id, title: '', content: '', updatedAt: Date.now() }
      const s = load()
      s[id] = note
      persist(s)
      return { id: note.id, title: note.title, updatedAt: note.updatedAt }
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
        content: src.content,
        updatedAt: Date.now(),
      }
      s[newId] = note
      persist(s)
      return { id: newId, title: newTitle, updatedAt: note.updatedAt }
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
        .map((n) => ({ id: n.id, title: n.title, updatedAt: n.updatedAt }))
        .sort((a, b) => b.updatedAt - a.updatedAt)
    },
    async loadTemplate(id) {
      return templates.load()[id] ?? null
    },
    async saveTemplate(id, title, content) {
      const s = templates.load()
      s[id] = { id, title, content, updatedAt: Date.now() }
      templates.persist(s)
    },
    async createTemplate() {
      const id = crypto.randomUUID()
      const note: Note = { id, title: '', content: '', updatedAt: Date.now() }
      const s = templates.load()
      s[id] = note
      templates.persist(s)
      return { id: note.id, title: note.title, updatedAt: note.updatedAt }
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
        content: src.content,
        updatedAt: Date.now(),
      }
      s[newId] = note
      templates.persist(s)
      return { id: newId, title: newTitle, updatedAt: note.updatedAt }
    },
    async searchTemplates(query) {
      return search(templates.load(), query)
    },
    async listArchive() {
      return Object.values(archive.load())
        .map((n) => ({ id: n.id, title: n.title, updatedAt: n.updatedAt }))
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
    async configGet() {
      const raw = localStorage.getItem('note-app-config')
      return raw ? JSON.parse(raw) : { vaultPath: '~/Documents/Note' }
    },
    async configSet(c) {
      const cur = await this.configGet()
      const next = { ...cur, ...c }
      localStorage.setItem('note-app-config', JSON.stringify(next))
      return next
    },
    async pickFolder() {
      return prompt('Vault path:') ?? ''
    },
    async saveAttachment(url) {
      return url
    },
  }
}

export const api: NoteApi =
  typeof window.noteList === 'function' ? nimApi() : localApi()
