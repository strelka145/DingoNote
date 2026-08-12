export interface NoteMeta {
  id: string
  title: string
  tags: string[]
  updatedAt: number
}

export interface Note extends NoteMeta {
  content: string
}

export interface SearchHit extends NoteMeta {
  snippet: string
}

// Runtime configuration reported by the backend. `platform` / `features` let the
// UI gate native-only actions (PDF export, folder picker); the localStorage
// fallback reports 'web' with both features off. configGet and configSet return
// this same shape so callers never have to special-case which one they called.
export interface AppConfig {
  vaultPath: string
  platform: string
  features: {
    pdfExport: boolean
    nativeFolderPicker: boolean
  }
}
