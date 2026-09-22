/** Fixed upstream URLs: request parameters can never select an outbound host. */
export const CISA_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json'
export const NEWS_QUERIES = ['cybersecurity', 'ransomware', 'vulnerability'] as const
export const NEWS_URLS = NEWS_QUERIES.map((query) => {
  const url = new URL('https://hn.algolia.com/api/v1/search_by_date')
  url.searchParams.set('query', query)
  url.searchParams.set('tags', 'story')
  url.searchParams.set('hitsPerPage', '6')
  return url.toString()
})

export const CISA_NAME = 'CISA Known Exploited Vulnerabilities'
export const NEWS_NAME = 'Hacker News Algolia cyber search'
export const CACHE_TTL_MS = 60_000
export const POLL_AFTER_MS = 60_000
export const ALLOWED_SOURCE_URLS = new Set([CISA_URL, ...NEWS_URLS])
