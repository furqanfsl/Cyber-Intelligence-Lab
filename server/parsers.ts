import type { KevItem, NewsItem } from '../shared/live-intel.ts'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback
  // Feed titles are plain labels, not a channel for terminal controls or bidi overrides.
  const normalized = value.replace(/\s+/gu, ' ').replace(/[\p{Cc}\p{Bidi_Control}]/gu, '').trim()
  let result = ''
  let length = 0
  for (const character of normalized) {
    if (length++ === 1_000) break
    result += character
  }
  return result || fallback
}

function dateOnly(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return
  const timestamp = Date.parse(`${value}T00:00:00.000Z`)
  if (Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value) return value
}

function timestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return
  if (!dateOnly(value.slice(0, 10))) return
  // Require a timezone so parsing does not depend on the server's locale.
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value)) return
  const milliseconds = Date.parse(value)
  if (Number.isFinite(milliseconds)) return new Date(milliseconds).toISOString()
}

export function cisaCatalogSearchUrl(cveId: string): string {
  const url = new URL('https://www.cisa.gov/known-exploited-vulnerabilities-catalog')
  url.searchParams.set('search_api_fulltext', cveId)
  return url.toString()
}

export function parseKev(data: unknown): KevItem[] {
  if (!record(data) || !Array.isArray(data.vulnerabilities)) throw new Error('Invalid CISA response')
  const items: KevItem[] = []
  for (const item of data.vulnerabilities) {
    if (!record(item)) continue
    const id = typeof item.cveID === 'string' ? item.cveID.trim().toUpperCase() : ''
    const dateAdded = dateOnly(item.dateAdded)
    if (id.length > 64 || !/^CVE-\d{4}-\d{4,}$/.test(id) || !dateAdded) continue
    items.push({
      id,
      title: text(item.vulnerabilityName, text(item.shortDescription, 'Known exploited vulnerability')),
      vendor: text(item.vendorProject, 'Unknown vendor'),
      product: text(item.product, 'Unknown product'),
      dateAdded,
      dueDate: dateOnly(item.dueDate) ?? 'Unknown',
      ransomwareUse: text(item.knownRansomwareCampaignUse, 'Unknown'),
      url: cisaCatalogSearchUrl(id),
    })
  }
  if (data.vulnerabilities.length && !items.length) throw new Error('No valid CISA records')
  const seen = new Set<string>()
  return items
    .sort((a, b) => b.dateAdded.localeCompare(a.dateAdded) || a.id.localeCompare(b.id))
    .filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
    .slice(0, 8)
}

export function parseNews(data: unknown): NewsItem[] {
  if (!record(data) || !Array.isArray(data.hits)) throw new Error('Invalid news response')
  const items: NewsItem[] = []
  for (const item of data.hits) {
    if (!record(item)) continue
    const id = typeof item.objectID === 'string' ? item.objectID.trim() : ''
    const title = text(item.title, text(item.story_title))
    const createdAt = timestamp(item.created_at)
    if (!/^[1-9]\d{0,19}$/.test(id) || !title || !createdAt) continue
    items.push({
      id,
      title,
      url: `https://news.ycombinator.com/item?id=${id}`,
      source: 'HN discussion record',
      author: text(item.author, 'unknown'),
      points: typeof item.points === 'number' && Number.isSafeInteger(item.points) && item.points >= 0 ? item.points : 0,
      createdAt,
    })
  }
  if (data.hits.length && !items.length) throw new Error('No valid news records')
  return mergeNews([items]).slice(0, 6)
}

/** Sort all searches together before capping; never favor the first query. */
export function mergeNews(groups: NewsItem[][]): NewsItem[] {
  const seen = new Set<string>()
  return groups.flat()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
    .filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
    .slice(0, 12)
}
