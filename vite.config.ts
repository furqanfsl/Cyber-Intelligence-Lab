import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import type { Connect } from 'vite'
import { randomUUID } from 'node:crypto'

type SourceHealth = {
  name: string
  status: 'ok' | 'error'
  count: number
  message?: string
}

type LiveIntelPayload = {
  generatedAt: string
  pollAfterMs: number
  cacheTtlMs: number
  sources: SourceHealth[]
  kev: Array<{
    id: string
    title: string
    vendor: string
    product: string
    dateAdded: string
    dueDate: string
    ransomwareUse: string
    url: string
  }>
  news: Array<{
    id: string
    title: string
    url: string
    source: string
    author: string
    points: number
    createdAt: string
  }>
}

const POLL_AFTER_MS = 60_000
const CACHE_TTL_MS = 60_000

let cachedPayload: LiveIntelPayload | null = null
let cacheExpiresAt = 0

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 9_000)

  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'CyberIntelligenceLab/1.0 defensive-portfolio-project',
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`)
    }

    return (await response.json()) as T
  } finally {
    clearTimeout(timeout)
  }
}

function cisaCatalogSearchUrl(cveId: string) {
  const url = new URL('https://www.cisa.gov/known-exploited-vulnerabilities-catalog')
  url.searchParams.set('search_api_fulltext', cveId)
  return url.toString()
}

function hackerNewsItemUrl(objectId: unknown) {
  if (typeof objectId === 'string' && /^\d+$/.test(objectId)) {
    return `https://news.ycombinator.com/item?id=${objectId}`
  }

  return 'https://news.ycombinator.com/'
}

async function getLiveIntel(): Promise<LiveIntelPayload> {
  const now = Date.now()

  if (cachedPayload && now < cacheExpiresAt) {
    return cachedPayload
  }

  const generatedAt = new Date().toISOString()
  const sources: SourceHealth[] = []

  const cisaPromise = fetchJson<{
    vulnerabilities?: Array<{
      cveID?: string
      vendorProject?: string
      product?: string
      vulnerabilityName?: string
      shortDescription?: string
      dateAdded?: string
      dueDate?: string
      knownRansomwareCampaignUse?: string
      notes?: string
    }>
  }>('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json')
    .then((data) => {
      const vulnerabilities = [...(data.vulnerabilities ?? [])]
        .sort((a, b) => String(b.dateAdded ?? '').localeCompare(String(a.dateAdded ?? '')))
        .slice(0, 8)
        .map((item) => ({
          id: item.cveID ?? 'CVE pending',
          title: item.vulnerabilityName ?? item.shortDescription ?? 'Known exploited vulnerability',
          vendor: item.vendorProject ?? 'Unknown vendor',
          product: item.product ?? 'Unknown product',
          dateAdded: item.dateAdded ?? 'Unknown',
          dueDate: item.dueDate ?? 'Unknown',
          ransomwareUse: item.knownRansomwareCampaignUse ?? 'Unknown',
          url: cisaCatalogSearchUrl(item.cveID ?? ''),
        }))

      sources.push({ name: 'CISA Known Exploited Vulnerabilities', status: 'ok', count: vulnerabilities.length })
      return vulnerabilities
    })
    .catch((error: unknown) => {
      sources.push({
        name: 'CISA Known Exploited Vulnerabilities',
        status: 'error',
        count: 0,
        message: error instanceof Error ? error.message : 'Unknown error',
      })
      return []
    })

  const buildHnUrl = (query: string) => {
    const url = new URL('https://hn.algolia.com/api/v1/search_by_date')
    url.searchParams.set('query', query)
    url.searchParams.set('tags', 'story')
    url.searchParams.set('hitsPerPage', '6')
    return url.toString()
  }

  type HnResponse = {
    hits?: Array<{
      objectID?: string
      title?: string
      story_title?: string
      url?: string
      story_url?: string
      author?: string
      points?: number
      created_at?: string
    }>
  }

  const newsPromise = Promise.all([
    fetchJson<HnResponse>(buildHnUrl('cybersecurity')),
    fetchJson<HnResponse>(buildHnUrl('ransomware')),
    fetchJson<HnResponse>(buildHnUrl('vulnerability')),
  ])
    .then((responses) => {
      const seen = new Set<string>()
      const news = responses
        .flatMap((data) => data.hits ?? [])
        .filter((item) => item.title || item.story_title)
        .filter((item) => {
          const id = item.objectID ?? item.url ?? item.title ?? item.story_title
          if (!id || seen.has(id)) {
            return false
          }
          seen.add(id)
          return true
        })
        .slice(0, 12)
        .map((item) => ({
          id: item.objectID ?? randomUUID(),
          title: item.title ?? item.story_title ?? 'Cybersecurity story',
          url: hackerNewsItemUrl(item.objectID),
          source: 'HN discussion record',
          author: item.author ?? 'unknown',
          points: item.points ?? 0,
          createdAt: item.created_at ?? generatedAt,
        }))

      sources.push({ name: 'Hacker News Algolia cyber search', status: 'ok', count: news.length })
      return news
    })
    .catch((error: unknown) => {
      sources.push({
        name: 'Hacker News Algolia cyber search',
        status: 'error',
        count: 0,
        message: error instanceof Error ? error.message : 'Unknown error',
      })
      return []
    })

  const [kev, news] = await Promise.all([cisaPromise, newsPromise])

  cachedPayload = {
    generatedAt,
    pollAfterMs: POLL_AFTER_MS,
    cacheTtlMs: CACHE_TTL_MS,
    sources,
    kev,
    news,
  }
  cacheExpiresAt = now + CACHE_TTL_MS

  return cachedPayload
}

function liveIntelPlugin(): Plugin {
  function attach(middlewares: Connect.Server) {
    middlewares.use('/api/live-intel', async (_request, response) => {
      try {
        const payload = await getLiveIntel()
        response.statusCode = 200
        response.setHeader('content-type', 'application/json; charset=utf-8')
        response.setHeader('cache-control', 'no-store')
        response.end(JSON.stringify(payload))
      } catch (error) {
        response.statusCode = 500
        response.setHeader('content-type', 'application/json; charset=utf-8')
        response.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : 'Unable to fetch live intelligence',
          }),
        )
      }
    })
  }

  return {
    name: 'cyber-intelligence-live-intel',
    configureServer(server) {
      attach(server.middlewares)
    },
    configurePreviewServer(server) {
      attach(server.middlewares)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), liveIntelPlugin()],
})
