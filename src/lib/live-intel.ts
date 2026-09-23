import type { LiveIntelPayload } from '../../shared/live-intel.ts'
import { CISA_NAME, MSRC_NAME, NEWS_NAME, isMsrcAdvisoryLink } from '../../shared/live-intel.ts'
import { isAbsoluteTimestamp, isCalendarDate } from './timestamps.ts'

export const DEFAULT_POLL_MS = 60_000
export const RETRY_POLL_MS = 90_000
export const REQUEST_TIMEOUT_MS = 20_000
export type LiveIntelStatus = 'connecting' | 'live' | 'partial' | 'stale' | 'error'

export type LiveIntelState = {
  data: LiveIntelPayload | null
  status: LiveIntelStatus
  isRefreshing: boolean
  error: string | null
  pollAfterMs: number
  isOnline: boolean
  lastCheckedAt: string | null
  nextCheckAt: string | null
}

export const initialIntelState: LiveIntelState = {
  data: null,
  status: 'connecting',
  isRefreshing: false,
  error: null,
  pollAfterMs: DEFAULT_POLL_MS,
  isOnline: true,
  lastCheckedAt: null,
  nextCheckAt: null,
}

export function boundedPollDelay(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(300_000, Math.max(30_000, value))
    : DEFAULT_POLL_MS
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasStrings(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => {
    const text = value[key]
    return typeof text === 'string' && text.length <= 2_000 && text.trim().length > 0 && [...text].length <= 1_000
  })
}

function isCount(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function hasUniqueIds(items: unknown[], caseInsensitive = false): boolean {
  const ids = items.map((item) => isRecord(item) && typeof item.id === 'string'
    ? caseInsensitive ? item.id.toLowerCase() : item.id
    : undefined)
  return ids.every((id) => typeof id === 'string') && new Set(ids).size === ids.length
}

function isSourceUrl(value: unknown, hostname: string): boolean {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === hostname && !url.username && !url.password && !url.port
  } catch {
    return false
  }
}

function isKevRecordLink(id: unknown, value: unknown): boolean {
  if (typeof id !== 'string' || id.length > 64 || !/^CVE-\d{4}-\d{4,}$/.test(id)) return false
  return isSourceUrl(value, 'www.cisa.gov') &&
    value === `https://www.cisa.gov/known-exploited-vulnerabilities-catalog?search_api_fulltext=${id}`
}

function isNewsRecordLink(id: unknown, value: unknown): boolean {
  if (typeof id !== 'string' || !/^[1-9]\d{0,19}$/.test(id)) return false
  return isSourceUrl(value, 'news.ycombinator.com') && value === `https://news.ycombinator.com/item?id=${id}`
}

/** Validate the same-origin response before rendering dates, links, or records. */
export function isLiveIntelPayload(value: unknown): value is LiveIntelPayload {
  if (!isRecord(value) || !isAbsoluteTimestamp(value.generatedAt)) return false
  if (typeof value.pollAfterMs !== 'number' || !Number.isFinite(value.pollAfterMs)) return false
  if (typeof value.cacheTtlMs !== 'number' || !Number.isFinite(value.cacheTtlMs) || value.cacheTtlMs < 0) return false
  if (!Array.isArray(value.sources) || value.sources.length !== 3) return false
  if (!isRecord(value.sources[0]) || value.sources[0].name !== CISA_NAME ||
    !isRecord(value.sources[1]) || value.sources[1].name !== NEWS_NAME ||
    !isRecord(value.sources[2]) || value.sources[2].name !== MSRC_NAME) return false
  if (!value.sources.every((source) => isRecord(source) && typeof source.name === 'string' &&
    ['ok', 'stale', 'error'].includes(String(source.status)) && isCount(source.count) &&
    (source.message === undefined || typeof source.message === 'string') &&
    (source.lastSuccessAt === undefined || isAbsoluteTimestamp(source.lastSuccessAt)))) return false
  if (!Array.isArray(value.kev) || !Array.isArray(value.news) || !Array.isArray(value.advisories)) return false
  if (value.sources[0].count !== value.kev.length || value.sources[1].count !== value.news.length || value.sources[2].count !== value.advisories.length) return false
  if (value.kev.length > 100 || value.news.length > 100 || value.advisories.length > 100) return false
  if (!hasUniqueIds(value.kev) || !hasUniqueIds(value.news) || !hasUniqueIds(value.advisories, true)) return false
  return value.kev.every((item) => isRecord(item) &&
    hasStrings(item, ['id', 'title', 'vendor', 'product', 'dateAdded', 'dueDate', 'ransomwareUse']) &&
    isCalendarDate(item.dateAdded) && (item.dueDate === 'Unknown' || isCalendarDate(item.dueDate)) && isKevRecordLink(item.id, item.url)) &&
    value.news.every((item) => isRecord(item) &&
      hasStrings(item, ['id', 'title', 'source', 'author']) && isAbsoluteTimestamp(item.createdAt) &&
      isCount(item.points) && isNewsRecordLink(item.id, item.url)) &&
    value.advisories.every((item) => isRecord(item) &&
      hasStrings(item, ['id', 'title', 'publishedAt', 'updatedAt']) &&
      isAbsoluteTimestamp(item.publishedAt) && isAbsoluteTimestamp(item.updatedAt) &&
      Date.parse(item.updatedAt as string) >= Date.parse(item.publishedAt as string) &&
      isMsrcAdvisoryLink(item.id, item.url))
}

export function intelStatus(payload: LiveIntelPayload): LiveIntelStatus {
  if (payload.sources.every((source) => source.status === 'ok')) return 'live'
  if (payload.sources.some((source) => source.status === 'ok' || (source.status === 'error' && source.count > 0))) return 'partial'
  return payload.kev.length || payload.news.length || payload.advisories.length ? 'stale' : 'error'
}

export function emptyFeedMessage(name: string, sourceStatus: 'ok' | 'stale' | 'error' | undefined, refreshing: boolean, serviceError: boolean): string {
  if (refreshing) return `Checking ${name}…`
  if (serviceError || sourceStatus === 'stale' || sourceStatus === 'error') {
    return `${name} is unavailable. Try refreshing or wait for the next check.`
  }
  return `No ${name} records are available.`
}

function retainUnavailableSources(payload: LiveIntelPayload, previous: LiveIntelPayload | null): LiveIntelPayload {
  if (!previous) return payload
  const result = { ...payload, sources: payload.sources.map((source) => ({ ...source })) }
  for (const [index, key] of (['kev', 'news', 'advisories'] as const).entries()) {
    if (result.sources[index].status === 'ok' || payload[key].length || !previous[key].length) continue
    if (key === 'kev') result.kev = previous.kev
    else if (key === 'news') result.news = previous.news
    else result.advisories = previous.advisories
    result.sources[index] = {
      ...result.sources[index],
      status: 'stale',
      count: previous[key].length,
      lastSuccessAt: previous.sources[index].lastSuccessAt ?? previous.generatedAt,
      message: `${result.sources[index].message ?? 'Source unavailable.'} Showing the previous browser snapshot.`,
    }
  }
  return result
}

class IntelRefreshError extends Error {}

type PollerOptions = {
  fetcher?: typeof fetch
  schedule?: typeof setTimeout
  cancel?: typeof clearTimeout
  now?: () => number
  onChange: (state: LiveIntelState) => void
}

/** One request owns the next poll. Manual refresh shares any in-flight request. */
export function createIntelPoller({ fetcher = fetch, schedule = setTimeout, cancel = clearTimeout, now = Date.now, onChange }: PollerOptions) {
  let state: LiveIntelState = { ...initialIntelState }
  let stopped = false
  let paused = false
  let resumeQueued = false
  let pending: Promise<void> | undefined
  let nextTimer: ReturnType<typeof setTimeout> | undefined
  let requestTimer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | undefined

  function publish(update: Partial<LiveIntelState>) {
    if (stopped) return
    state = { ...state, ...update }
    onChange(state)
  }

  function refresh(): Promise<void> {
    if (stopped || paused || !state.isOnline) return Promise.resolve()
    if (pending) return pending
    if (nextTimer !== undefined) cancel(nextTimer)
    nextTimer = undefined
    controller = new AbortController()
    const requestController = controller
    publish({ isRefreshing: true, error: null, nextCheckAt: null })

    pending = (async () => {
      let delay = RETRY_POLL_MS
      let abortRequest: (() => void) | undefined
      try {
        const cancelled = new Promise<never>((_, reject) => {
          abortRequest = () => reject(new DOMException('Polling suspended', 'AbortError'))
          requestController.signal.addEventListener('abort', abortRequest, { once: true })
        })
        const timeout = new Promise<never>((_, reject) => {
          requestTimer = schedule(() => {
            reject(new IntelRefreshError('The request timed out. Automatic retry is scheduled.'))
            requestController.abort()
          }, REQUEST_TIMEOUT_MS)
        })
        const request = (async () => {
          const response = await fetcher('/api/live-intel', { cache: 'no-store', redirect: 'error', signal: requestController.signal })
          if (!response.ok) throw new IntelRefreshError('The intelligence service is unavailable. Automatic retry is scheduled.')
          const payload: unknown = await response.json().catch(() => {
            throw new IntelRefreshError('The intelligence service returned invalid data. Automatic retry is scheduled.')
          })
          if (!isLiveIntelPayload(payload)) throw new IntelRefreshError('The intelligence service returned invalid data. Automatic retry is scheduled.')
          return payload
        })()
        const payload = retainUnavailableSources(await Promise.race([request, timeout, cancelled]), state.data)
        delay = boundedPollDelay(payload.pollAfterMs)
        publish({ data: payload, status: intelStatus(payload), error: null, pollAfterMs: delay, lastCheckedAt: new Date(now()).toISOString() })
      } catch (error) {
        if (stopped || paused || !state.isOnline) return
        if (requestController.signal.aborted && !(error instanceof IntelRefreshError)) return
        publish({
          status: state.data ? 'stale' : 'error',
          error: error instanceof IntelRefreshError ? error.message : 'Could not reach the intelligence service. Automatic retry is scheduled.',
          pollAfterMs: delay,
          lastCheckedAt: new Date(now()).toISOString(),
        })
      } finally {
        if (requestTimer !== undefined) cancel(requestTimer)
        if (abortRequest) requestController.signal.removeEventListener('abort', abortRequest)
        requestTimer = undefined
        pending = undefined
        publish({ isRefreshing: false })
        if (!stopped && !paused && state.isOnline) {
          if (resumeQueued) {
            resumeQueued = false
            void refresh()
          } else {
            nextTimer = schedule(() => { void refresh() }, delay)
            publish({ nextCheckAt: new Date(now() + delay).toISOString() })
          }
        }
      }
    })()
    return pending
  }

  return {
    refresh,
    pause() {
      if (stopped || paused) return
      paused = true
      resumeQueued = false
      if (nextTimer !== undefined) cancel(nextTimer)
      nextTimer = undefined
      controller?.abort()
      publish({ nextCheckAt: null })
    },
    resume() {
      if (stopped || !paused) return
      paused = false
      if (!state.isOnline) return
      if (pending) resumeQueued = true
      else void refresh()
    },
    setOnline(online: boolean) {
      if (stopped || state.isOnline === online) return
      if (!online) {
        resumeQueued = false
        if (nextTimer !== undefined) cancel(nextTimer)
        nextTimer = undefined
        controller?.abort()
        publish({
          isOnline: false,
          isRefreshing: false,
          nextCheckAt: null,
          status: state.data ? 'stale' : 'error',
          error: state.data
            ? 'You are offline. Showing saved records; reconnect to check public sources.'
            : 'You are offline. Reconnect to load public intelligence.',
        })
      } else {
        publish({ isOnline: true, error: null })
        if (paused) return
        if (pending) resumeQueued = true
        else void refresh()
      }
    },
    stop() {
      stopped = true
      if (nextTimer !== undefined) cancel(nextTimer)
      if (requestTimer !== undefined) cancel(requestTimer)
      controller?.abort()
    },
  }
}
