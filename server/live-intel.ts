import type { AdvisoryItem, KevItem, LiveIntelPayload, NewsItem, SourceHealth } from '../shared/live-intel.ts'
import { createJsonLoader, type JsonLoader } from './fetch-json.ts'
import { mergeNews, parseAdvisories, parseKev, parseNews } from './parsers.ts'
import { CACHE_TTL_MS, CISA_NAME, CISA_URL, MSRC_NAME, MSRC_URL, NEWS_NAME, NEWS_URLS, POLL_AFTER_MS } from './sources.ts'

type Snapshot<T> = { data: T[]; lastSuccessAt: string }
type SourceResult<T> = { snapshot?: Snapshot<T>; failed: boolean }
type ServiceOptions = { loadJson?: JsonLoader; now?: () => number }

function freezePayload(payload: LiveIntelPayload): LiveIntelPayload {
  for (const collection of [payload.sources, payload.kev, payload.news, payload.advisories]) {
    for (const item of collection) Object.freeze(item)
    Object.freeze(collection)
  }
  return Object.freeze(payload)
}

/** One instance per server: single-flight refresh and per-query last-known-good data. */
export function createLiveIntelService({ loadJson = createJsonLoader(), now = Date.now }: ServiceOptions = {}) {
  let cachedPayload: LiveIntelPayload | undefined
  let cachedAt = 0
  let expiresAt = 0
  let inFlight: Promise<LiveIntelPayload> | undefined
  let cisa: Snapshot<KevItem> | undefined
  let msrc: Snapshot<AdvisoryItem> | undefined
  const news = new Map<string, Snapshot<NewsItem>>()
  let newsLastSuccessAt: string | undefined

  async function read<T>(url: string, parse: (data: unknown) => T[], previous?: Snapshot<T>): Promise<SourceResult<T>> {
    try {
      const data = parse(await loadJson(url))
      return { snapshot: { data, lastSuccessAt: new Date(now()).toISOString() }, failed: false }
    } catch {
      return { snapshot: previous, failed: true }
    }
  }

  async function refresh(): Promise<LiveIntelPayload> {
    const [cisaResult, newsResults, msrcResult] = await Promise.all([
      read(CISA_URL, parseKev, cisa),
      Promise.all(NEWS_URLS.map((url) => read(url, parseNews, news.get(url)))),
      read(MSRC_URL, parseAdvisories, msrc),
    ])
    cisa = cisaResult.snapshot
    msrc = msrcResult.snapshot
    newsResults.forEach((result, index) => {
      if (result.snapshot) news.set(NEWS_URLS[index], result.snapshot)
    })
    const generatedAt = new Date(now()).toISOString()
    const kev = cisa?.data ?? []
    const advisories = msrc?.data ?? []
    // A fresh query wins over a retained copy of the same story (including points/title updates).
    const newsItems = mergeNews([
      ...newsResults.filter((result) => !result.failed),
      ...newsResults.filter((result) => result.failed),
    ].map((result) => result.snapshot?.data ?? []))
    const failedNews = newsResults.filter((result) => result.failed)
    const staleNews = failedNews.some((result) => result.snapshot !== undefined)
    if (!failedNews.length) newsLastSuccessAt = generatedAt

    const cisaHealth: SourceHealth = {
      name: CISA_NAME,
      status: cisaResult.failed ? (cisa ? 'stale' : 'error') : 'ok',
      count: kev.length,
      ...(cisa ? { lastSuccessAt: cisa.lastSuccessAt } : {}),
      ...(cisaResult.failed ? { message: cisa ? 'Source unavailable. Showing the last successful CISA refresh.' : 'CISA is temporarily unavailable. Retrying automatically.' } : {}),
    }
    const newsHealth: SourceHealth = {
      name: NEWS_NAME,
      status: failedNews.length ? (staleNews ? 'stale' : 'error') : 'ok',
      count: newsItems.length,
      ...(newsLastSuccessAt ? { lastSuccessAt: newsLastSuccessAt } : {}),
      ...(failedNews.length ? {
        message: `${failedNews.length} of ${NEWS_URLS.length} news searches unavailable. ${staleNews ? 'Keeping their last successful results alongside available updates.' : 'Showing available results and retrying automatically.'}`,
      } : {}),
    }
    const msrcHealth: SourceHealth = {
      name: MSRC_NAME,
      status: msrcResult.failed ? (msrc ? 'stale' : 'error') : 'ok',
      count: advisories.length,
      ...(msrc ? { lastSuccessAt: msrc.lastSuccessAt } : {}),
      ...(msrcResult.failed ? { message: msrc ? 'Source unavailable. Showing the last successful Microsoft refresh.' : 'Microsoft security updates are temporarily unavailable. Retrying automatically.' } : {}),
    }
    return { generatedAt, pollAfterMs: POLL_AFTER_MS, cacheTtlMs: CACHE_TTL_MS, sources: [cisaHealth, newsHealth, msrcHealth], kev, news: newsItems, advisories }
  }

  return {
    get(): Promise<LiveIntelPayload> {
      if (inFlight) return inFlight
      const currentTime = now()
      // A backwards wall-clock adjustment must not keep an old snapshot fresh indefinitely.
      if (cachedPayload && currentTime >= cachedAt && currentTime < expiresAt) return Promise.resolve(cachedPayload)
      inFlight = refresh().then((payload) => {
        cachedPayload = freezePayload(payload)
        // Network time must not shorten the advertised cache duration.
        cachedAt = now()
        expiresAt = cachedAt + CACHE_TTL_MS
        return payload
      }).finally(() => { inFlight = undefined })
      return inFlight
    },
  }
}
