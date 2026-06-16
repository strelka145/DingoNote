import type { Note, NoteMeta, SearchHit } from './types'

interface NoteApi {
  listNotes(): Promise<NoteMeta[]>
  loadNote(id: string): Promise<Note | null>
  saveNote(id: string, title: string, content: string): Promise<void>
  createNote(): Promise<NoteMeta>
  deleteNote(id: string): Promise<void>
  searchNotes(query: string): Promise<SearchHit[]>
  listTemplates(): Promise<NoteMeta[]>
  loadTemplate(id: string): Promise<Note | null>
  saveTemplate(id: string, title: string, content: string): Promise<void>
  createTemplate(): Promise<NoteMeta>
  deleteTemplate(id: string): Promise<void>
  searchTemplates(query: string): Promise<SearchHit[]>
  exportPDF(filename: string): Promise<void>
}

declare global {
  interface Window {
    noteList?: () => Promise<NoteMeta[]>
    noteLoad?: (id: string) => Promise<Note | null>
    noteSave?: (id: string, title: string, content: string) => Promise<void>
    noteCreate?: () => Promise<NoteMeta>
    noteDelete?: (id: string) => Promise<void>
    noteSearch?: (query: string) => Promise<SearchHit[]>
    templateList?: () => Promise<NoteMeta[]>
    templateLoad?: (id: string) => Promise<Note | null>
    templateSave?: (id: string, title: string, content: string) => Promise<void>
    templateCreate?: () => Promise<NoteMeta>
    templateDelete?: (id: string) => Promise<void>
    templateSearch?: (query: string) => Promise<SearchHit[]>
    exportPDF?: (filename: string) => Promise<void>
  }
}

function nimApi(): NoteApi {
  return {
    listNotes: () => window.noteList!(),
    loadNote: (id) => window.noteLoad!(id),
    saveNote: (id, title, content) => window.noteSave!(id, title, content),
    createNote: () => window.noteCreate!(),
    deleteNote: (id) => window.noteDelete!(id),
    searchNotes: (query) => window.noteSearch!(query),
    listTemplates: () => window.templateList!(),
    loadTemplate: (id) => window.templateLoad!(id),
    saveTemplate: (id, title, content) =>
      window.templateSave!(id, title, content),
    createTemplate: () => window.templateCreate!(),
    deleteTemplate: (id) => window.templateDelete!(id),
    searchTemplates: (query) => window.templateSearch!(query),
    exportPDF: (filename) => window.exportPDF!(filename),
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
      delete s[id]
      persist(s)
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
    async searchTemplates(query) {
      return search(templates.load(), query)
    },
    async exportPDF() {
      window.print()
    },
  }
}

export const api: NoteApi =
  typeof window.noteList === 'function' ? nimApi() : localApi()
