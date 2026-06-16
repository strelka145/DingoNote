import type { Note, NoteMeta, SearchHit } from './types'

interface NoteApi {
  listNotes(): Promise<NoteMeta[]>
  loadNote(id: string): Promise<Note | null>
  saveNote(id: string, title: string, content: string): Promise<void>
  createNote(): Promise<NoteMeta>
  deleteNote(id: string): Promise<void>
  searchNotes(query: string): Promise<SearchHit[]>
}

declare global {
  interface Window {
    noteList?: () => Promise<NoteMeta[]>
    noteLoad?: (id: string) => Promise<Note | null>
    noteSave?: (id: string, title: string, content: string) => Promise<void>
    noteCreate?: () => Promise<NoteMeta>
    noteDelete?: (id: string) => Promise<void>
    noteSearch?: (query: string) => Promise<SearchHit[]>
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
  }
}

function localApi(): NoteApi {
  const KEY = 'note-app-data'
  type Store = Record<string, Note>
  const load = (): Store => JSON.parse(localStorage.getItem(KEY) ?? '{}')
  const persist = (s: Store) => localStorage.setItem(KEY, JSON.stringify(s))
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
      const q = query.trim().toLowerCase()
      const list = Object.values(load())
      const hits: SearchHit[] = []
      for (const n of list) {
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
    },
  }
}

export const api: NoteApi =
  typeof window.noteList === 'function' ? nimApi() : localApi()
