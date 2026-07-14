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
