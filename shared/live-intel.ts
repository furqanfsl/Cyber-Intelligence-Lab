/** Public API contract shared by the dashboard and the local Vite middleware. */
export const CISA_NAME = 'CISA Known Exploited Vulnerabilities'
export const NEWS_NAME = 'Hacker News Algolia cyber search'
export const MSRC_NAME = 'Microsoft Security Response Center'

/** MSRC release identifiers include historical case and out-of-band suffixes. */
export function isMsrcAdvisoryId(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && /^\d{4}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:-[A-Z])?$/i.test(value)
}

export function isMsrcAdvisoryLink(id: unknown, value: unknown): boolean {
  return isMsrcAdvisoryId(id) && value === `https://msrc.microsoft.com/update-guide/releaseNote/${id}`
}

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

/** Vendor-published release notes, not evidence of attacks on this application. */
export type AdvisoryItem = {
  id: string
  title: string
  publishedAt: string
  updatedAt: string
  url: string
}

export type LiveIntelPayload = {
  generatedAt: string
  pollAfterMs: number
  cacheTtlMs: number
  sources: SourceHealth[]
  kev: KevItem[]
  news: NewsItem[]
  advisories: AdvisoryItem[]
}
