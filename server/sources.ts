/** Fixed upstream URLs: request parameters can never select an outbound host. */
export const CISA_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json'
export const NEWS_QUERIES = Object.freeze(['cybersecurity', 'ransomware', 'vulnerability'] as const)
export const NEWS_URLS = Object.freeze(NEWS_QUERIES.map((query) => {
  const url = new URL('https://hn.algolia.com/api/v1/search_by_date')
  url.searchParams.set('query', query)
  url.searchParams.set('tags', 'story')
  url.searchParams.set('hitsPerPage', '6')
  return url.toString()
}))

export { CISA_NAME, NEWS_NAME } from '../shared/live-intel.ts'
export const CACHE_TTL_MS = 60_000
export const POLL_AFTER_MS = 60_000
const allowedSourceUrls = new Set([CISA_URL, ...NEWS_URLS])

export function isAllowedSourceUrl(url: string): boolean {
  return allowedSourceUrls.has(url)
}
