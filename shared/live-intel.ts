/** Public API contract shared by the dashboard and the local Vite middleware. */
export const CISA_NAME = 'CISA Known Exploited Vulnerabilities'
export const NEWS_NAME = 'Hacker News Algolia cyber search'

export type SourceHealth = {
  name: string
  status: 'ok' | 'stale' | 'error'
  count: number
  message?: string
  lastSuccessAt?: string
}

export type KevItem = {
  id: string
  title: string
  vendor: string
  product: string
  dateAdded: string
  dueDate: string
  ransomwareUse: string
  url: string
}

export type NewsItem = {
  id: string
  title: string
  url: string
  source: string
  author: string
  points: number
  createdAt: string
}

export type LiveIntelPayload = {
  generatedAt: string
  pollAfterMs: number
  cacheTtlMs: number
  sources: SourceHealth[]
  kev: KevItem[]
  news: NewsItem[]
}
