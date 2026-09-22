import assert from 'node:assert/strict'
import { test } from 'node:test'
import { boundedPollDelay, createIntelPoller, emptyFeedMessage, intelStatus, isLiveIntelPayload, DEFAULT_POLL_MS, REQUEST_TIMEOUT_MS, RETRY_POLL_MS } from '../../src/lib/live-intel.ts'

function fixture() {
  return {
    generatedAt: '2026-09-22T12:00:00.000Z', pollAfterMs: 60_000, cacheTtlMs: 60_000,
    sources: [
      { name: 'CISA Known Exploited Vulnerabilities', status: 'ok', count: 1 },
      { name: 'Hacker News Algolia cyber search', status: 'ok', count: 1 },
    ],
    kev: [{ id: 'CVE-2026-12345', title: 'Example vulnerability', vendor: 'Example', product: 'App', dateAdded: '2026-09-22', dueDate: '2026-10-13', ransomwareUse: 'Unknown', url: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog?search_api_fulltext=CVE-2026-12345' }],
    news: [{ id: '123', title: 'Example story', source: 'Hacker News', author: 'example', points: 4, createdAt: '2026-09-22T11:00:00Z', url: 'https://news.ycombinator.com/item?id=123' }],
  }
}

function scheduler() {
  let nextId = 0
  const jobs = new Map()
  return {
    schedule(fn, delay) { const id = ++nextId; jobs.set(id, { fn, delay }); return id },
    cancel(id) { jobs.delete(id) },
    delays() { return [...jobs.values()].map((job) => job.delay) },
    run(delay) {
      const entry = [...jobs].find(([, job]) => job.delay === delay)
      assert.ok(entry, `No timer scheduled at ${delay} ms`)
      jobs.delete(entry[0]); entry[1].fn()
    },
  }
}

function client(fetcher) {
  const clock = scheduler()
  const states = []
  const poller = createIntelPoller({ fetcher, schedule: clock.schedule, cancel: clock.cancel, onChange: (state) => states.push(state) })
  return { clock, states, poller, latest: () => states.at(-1) }
}

const response = (payload = fixture()) => new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } })
const flush = () => new Promise((resolve) => setImmediate(resolve))

test('accepts public source contract and optional health metadata', () => {
  const data = fixture(); data.sources[0].lastSuccessAt = data.generatedAt
  data.sources[1].status = 'stale'; data.sources[1].message = 'Retaining last good records'
  assert.equal(isLiveIntelPayload(data), true)
})
test('rejects nonobjects, missing collections, and invalid timestamps', () => {
  for (const value of [null, [], 'html', {}, { ...fixture(), news: undefined }, { ...fixture(), generatedAt: 'yesterday' }]) assert.equal(isLiveIntelPayload(value), false)
})
test('rejects script, unrelated, credentialed, and insecure source URLs', () => {
  for (const url of ['javascript:alert(1)', 'https://evil.example/', 'http://www.cisa.gov/', 'https://user@www.cisa.gov/', 'https://www.cisa.gov:444/']) {
    const data = fixture(); data.kev[0].url = url; assert.equal(isLiveIntelPayload(data), false, url)
  }
})
test('rejects invalid source status, counts, and last-success timestamps', () => {
  for (const patch of [{ status: 'healthy' }, { count: -1 }, { count: 0.5 }, { lastSuccessAt: 'invalid' }]) {
    const data = fixture(); Object.assign(data.sources[0], patch); assert.equal(isLiveIntelPayload(data), false)
  }
})
test('rejects malformed news and vulnerability records instead of crashing render', () => {
  const data = fixture(); data.news[0].createdAt = 'invalid'; assert.equal(isLiveIntelPayload(data), false)
  data.news = fixture().news; data.kev[0].title = null; assert.equal(isLiveIntelPayload(data), false)
})
test('bounds source records accepted by the UI', () => {
  const data = fixture(); data.news = Array(101).fill(data.news[0]); assert.equal(isLiveIntelPayload(data), false)
})
test('poll delay bounds zero, negative, nonfinite, and omitted values', () => {
  assert.equal(boundedPollDelay(0), 30_000); assert.equal(boundedPollDelay(-10), 30_000)
  assert.equal(boundedPollDelay(999_999), 300_000); assert.equal(boundedPollDelay(90_000), 90_000)
  for (const value of [NaN, Infinity, undefined, '1']) assert.equal(boundedPollDelay(value), DEFAULT_POLL_MS)
})
test('distinguishes current, partially available, stale, and failed sources', () => {
  const data = fixture(); assert.equal(intelStatus(data), 'live')
  data.sources[1].status = 'error'; assert.equal(intelStatus(data), 'partial')
  data.sources[0].status = 'stale'; data.sources[1].count = 0; assert.equal(intelStatus(data), 'stale')
  data.kev = []; data.news = []; assert.equal(intelStatus(data), 'error')
})
test('success publishes data and schedules exactly one next check', async () => {
  const c = client(async () => response()); await c.poller.refresh()
  assert.equal(c.latest().status, 'live'); assert.equal(c.latest().isRefreshing, false)
  assert.equal(c.latest().data.kev[0].id, 'CVE-2026-12345'); assert.deepEqual(c.clock.delays(), [60_000])
  c.poller.stop(); assert.deepEqual(c.clock.delays(), [])
})
test('concurrent manual refreshes share one in-flight request', async () => {
  let complete; let calls = 0
  const c = client(() => { calls++; return new Promise((resolve) => { complete = resolve }) })
  const first = c.poller.refresh(); const second = c.poller.refresh()
  assert.equal(first, second); assert.equal(calls, 1)
  complete(response()); await first; assert.deepEqual(c.clock.delays(), [60_000]); c.poller.stop()
})
test('manual refresh cancels the old scheduled poll', async () => {
  let calls = 0; const c = client(async () => { calls++; return response() })
  await c.poller.refresh(); await c.poller.refresh()
  assert.equal(calls, 2); assert.deepEqual(c.clock.delays(), [60_000]); c.poller.stop()
})
test('automatic refresh starts only after prior request completes', async () => {
  let calls = 0; const c = client(async () => { calls++; return response() })
  await c.poller.refresh(); c.clock.run(60_000); await flush()
  assert.equal(calls, 2); assert.deepEqual(c.clock.delays(), [60_000]); c.poller.stop()
})
test('transport failure retains previous snapshot and marks it stale', async () => {
  let failed = false; const c = client(async () => { if (failed) throw new Error('Offline'); return response() })
  await c.poller.refresh(); const previous = c.latest().data; failed = true; await c.poller.refresh()
  assert.equal(c.latest().data, previous); assert.equal(c.latest().status, 'stale')
  assert.equal(c.latest().pollAfterMs, RETRY_POLL_MS); c.poller.stop()
})
test('first-load HTTP failure produces an honest error and scheduled retry', async () => {
  const c = client(async () => new Response('Unavailable', { status: 503 })); await c.poller.refresh()
  assert.equal(c.latest().status, 'error'); assert.equal(c.latest().data, null)
  assert.match(c.latest().error, /unavailable/); assert.deepEqual(c.clock.delays(), [RETRY_POLL_MS]); c.poller.stop()
})
test('malformed JSON and invalid payloads do not replace good data', async () => {
  const replies = [response(), new Response('<html>'), response({ invalid: true })]
  const c = client(async () => replies.shift()); await c.poller.refresh(); const original = c.latest().data
  await c.poller.refresh(); assert.equal(c.latest().status, 'stale'); assert.equal(c.latest().data, original)
  await c.poller.refresh(); assert.equal(c.latest().data, original); assert.match(c.latest().error, /invalid data/); c.poller.stop()
})
test('hung request times out, aborts, clears busy state, and schedules retry', async () => {
  let signal; const c = client((_url, options) => { signal = options.signal; return new Promise(() => {}) })
  const request = c.poller.refresh(); c.clock.run(REQUEST_TIMEOUT_MS); await request
  assert.equal(signal.aborted, true); assert.equal(c.latest().isRefreshing, false)
  assert.match(c.latest().error, /timed out/); assert.deepEqual(c.clock.delays(), [RETRY_POLL_MS]); c.poller.stop()
})
test('stopping aborts in-flight work and suppresses late updates and retries', async () => {
  let complete; let signal
  const c = client((_url, options) => { signal = options.signal; return new Promise((resolve) => { complete = resolve }) })
  const request = c.poller.refresh(); const count = c.states.length
  c.poller.stop(); assert.equal(signal.aborted, true); complete(response()); await request
  assert.equal(c.states.length, count); assert.deepEqual(c.clock.delays(), [])
  await c.poller.refresh(); assert.equal(c.states.length, count)
})
test('successful retry clears previous error state', async () => {
  let failed = true; const c = client(async () => { if (failed) throw new Error('Offline'); return response() })
  await c.poller.refresh(); failed = false; await c.poller.refresh()
  assert.equal(c.latest().status, 'live'); assert.equal(c.latest().error, null); c.poller.stop()
})

test('a restarted server cannot erase browser snapshots for unavailable sources', async () => {
  const unavailable = fixture()
  unavailable.sources = unavailable.sources.map(source => ({ ...source, status: 'error', count: 0 }))
  unavailable.kev = []; unavailable.news = []
  const replies = [response(), response(unavailable)]
  const c = client(async () => replies.shift())
  await c.poller.refresh(); await c.poller.refresh()
  assert.equal(c.latest().status, 'stale')
  assert.equal(c.latest().data.kev.length, 1); assert.equal(c.latest().data.news.length, 1)
  assert.equal(c.latest().data.sources[0].status, 'stale')
  assert.match(c.latest().data.sources[0].message, /previous browser snapshot/)
  c.poller.stop()
})
test('a successful empty source replaces old records instead of retaining them forever', async () => {
  const empty = fixture(); empty.kev = []; empty.news = []
  empty.sources = empty.sources.map(source => ({ ...source, count: 0 }))
  const replies = [response(), response(empty)]
  const c = client(async () => replies.shift())
  await c.poller.refresh(); await c.poller.refresh()
  assert.equal(c.latest().status, 'live'); assert.equal(c.latest().data.kev.length, 0)
  assert.equal(c.latest().data.news.length, 0); c.poller.stop()
})

test('partially successful news queries are partial rather than stale on first load', async () => {
  const data = fixture()
  data.sources[0] = { ...data.sources[0], status: 'error', count: 0 }
  data.sources[1] = { ...data.sources[1], status: 'error', count: 1 }
  data.kev = []
  const c = client(async () => response(data))
  await c.poller.refresh()
  assert.equal(c.latest().status, 'partial')
  assert.equal(c.latest().data.news.length, 1)
  c.poller.stop()
})

test('healthy empty sources are not labelled unavailable when another source fails', () => {
  assert.equal(emptyFeedMessage('CISA', 'ok', false, false), 'No CISA records are available.')
  assert.match(emptyFeedMessage('news', 'error', false, false), /unavailable/)
  assert.match(emptyFeedMessage('CISA', 'ok', false, true), /unavailable/)
  assert.equal(emptyFeedMessage('CISA', undefined, true, false), 'Checking CISA…')
})
