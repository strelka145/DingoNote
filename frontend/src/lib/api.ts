import type { AppConfig, Note, NoteMeta, SearchHit } from './types'
import { localApi } from './api.local'

export interface NoteApi {
  listNotes(): Promise<NoteMeta[]>
  loadNote(id: string): Promise<Note | null>
  saveNote(
    id: string,
    title: string,
    tags: string[],
    content: string,
  ): Promise<void>
  createNote(): Promise<NoteMeta>
  deleteNote(id: string): Promise<void>
  duplicateNote(id: string): Promise<NoteMeta>
  renameWikilinks(oldTitle: string, newTitle: string): Promise<number>
  searchNotes(query: string): Promise<SearchHit[]>
  listTemplates(): Promise<NoteMeta[]>
  loadTemplate(id: string): Promise<Note | null>
  saveTemplate(
    id: string,
    title: string,
    tags: string[],
    content: string,
  ): Promise<void>
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
  configGet(): Promise<AppConfig>
  configSet(config: { vaultPath?: string }): Promise<AppConfig>
  pickFolder(startPath?: string): Promise<string | null>
  writeGitignore(): Promise<{ created: boolean; path: string }>
  saveAttachment(dataUrl: string): Promise<string>
}

// The name each NoteApi method is bound under on `window` by the Nim backend
// (src/note.nim `handlers`). Keeping the mapping here — and nowhere else — means
// a rename touches one line; `satisfies Record<keyof NoteApi, string>` makes TS
// verify every method is mapped and nothing extra sneaks in.
const BIND = {
  listNotes: 'noteList',
  loadNote: 'noteLoad',
  saveNote: 'noteSave',
  createNote: 'noteCreate',
  deleteNote: 'noteDelete',
  duplicateNote: 'noteDuplicate',
  renameWikilinks: 'renameWikilinks',
  searchNotes: 'noteSearch',
  listTemplates: 'templateList',
  loadTemplate: 'templateLoad',
  saveTemplate: 'templateSave',
  createTemplate: 'templateCreate',
  deleteTemplate: 'templateDelete',
  duplicateTemplate: 'templateDuplicate',
  searchTemplates: 'templateSearch',
  listArchive: 'archiveList',
  loadArchive: 'archiveLoad',
  searchArchive: 'archiveSearch',
  restoreNote: 'archiveRestore',
  purgeArchive: 'archivePurge',
  exportPDF: 'exportPDF',
  configGet: 'configGet',
  configSet: 'configSet',
  pickFolder: 'pickFolder',
  writeGitignore: 'writeGitignore',
  saveAttachment: 'saveAttachment',
} as const satisfies Record<keyof NoteApi, string>

// The Nim webview binds each handler as an async function on `window`.
type Bound = (...args: unknown[]) => Promise<unknown>
const win = window as unknown as Record<string, Bound | undefined>

// Forward every NoteApi method to its bound window function via BIND — one line
// of truth instead of a hand-written delegate per method. Argument shapes are
// checked at the call sites against NoteApi; the bridge itself is untyped.
function nimApi(): NoteApi {
  const call = (name: keyof NoteApi, ...args: unknown[]) => win[BIND[name]]!(...args)
  const entries = (Object.keys(BIND) as (keyof NoteApi)[]).map((name) => [
    name,
    (...args: unknown[]) => call(name, ...args),
  ])
  return Object.fromEntries(entries) as unknown as NoteApi
}

// Nim binds its handlers on `window`; when they're absent we're in a plain
// browser (dev/preview) and fall back to the localStorage implementation.
export const api: NoteApi =
  typeof win.noteList === 'function' ? nimApi() : localApi()
