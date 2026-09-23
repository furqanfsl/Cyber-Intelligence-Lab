import assert from 'node:assert/strict'
import test from 'node:test'
import { createLiveIntelService } from '../../server/live-intel.ts'
import { CACHE_TTL_MS, CISA_NAME, CISA_URL, MSRC_NAME, MSRC_URL, NEWS_NAME, NEWS_URLS } from '../../server/sources.ts'
import { advisoryRecord, kevRecord, newsRecord } from './fixtures.ts'

function successfulData(url: string) {
  if (url === MSRC_URL) return { value: [advisoryRecord()] }
  return url === CISA_URL ? { vulnerabilities: [kevRecord()] } : { hits: [newsRecord({ objectID: String(100 + NEWS_URLS.indexOf(url)) })] }
}

test('simultaneous callers share one five-request upstream refresh', async () => {
  const pending = new Map<string, (value: unknown) => void>()
  let calls = 0
  const service = createLiveIntelService({ loadJson: (url) => { calls++; return new Promise((resolve) => pending.set(url, resolve)) } })
  const requests = Array.from({ length: 20 }, () => service.get())
  assert.equal(calls, 5)
  assert.strictEqual(requests[0], requests[19])
  for (const [url, resolve] of pending) resolve(successfulData(url))
  const payloads = await Promise.all(requests)
  assert.ok(payloads.every((payload) => payload === payloads[0]))
  assert.equal(payloads[0].kev.length, 1)
  assert.equal(payloads[0].news.length, 3)
  assert.equal(payloads[0].advisories.length, 1)
})

test('cache TTL starts after network completion and expires at the exact boundary', async () => {
  let time = 1_000
  let calls = 0
  let finish: (() => void) | undefined
  const gate = new Promise<void>((resolve) => { finish = resolve })
  const service = createLiveIntelService({ now: () => time, loadJson: async (url) => { calls++; await gate; return successfulData(url) } })
  const firstRequest = service.get()
  time += 9_000
  finish!()
  const first = await firstRequest
  assert.equal(first.generatedAt, new Date(time).toISOString())
  time += CACHE_TTL_MS - 1
  assert.strictEqual(await service.get(), first)
  assert.equal(calls, 5)
  time++
  assert.notStrictEqual(await service.get(), first)
  assert.equal(calls, 10)
})

test('source health order is stable even when CISA completes last', async () => {
  let finish: ((value: unknown) => void) | undefined
  const service = createLiveIntelService({ loadJson: (url) => url === CISA_URL ? new Promise((resolve) => { finish = resolve }) : Promise.resolve(successfulData(url)) })
  const request = service.get()
  await Promise.resolve()
  finish!({ vulnerabilities: [kevRecord()] })
  const payload = await request
  assert.deepEqual(payload.sources.map(({ name, status, count }) => ({ name, status, count })), [
    { name: CISA_NAME, status: 'ok', count: 1 },
    { name: NEWS_NAME, status: 'ok', count: 3 },
    { name: MSRC_NAME, status: 'ok', count: 1 },
  ])
})

test('one failed news query does not discard the two healthy searches', async () => {
  const service = createLiveIntelService({ loadJson: async (url) => {
    if (url === NEWS_URLS[1]) throw new Error('private upstream diagnostics')
    return successfulData(url)
  } })
  const payload = await service.get()
  assert.deepEqual(payload.news.map((item) => item.id), ['100', '102'])
  assert.equal(payload.sources[0].status, 'ok')
  assert.equal(payload.sources[1].status, 'error')
  assert.equal(payload.sources[1].count, 2)
  assert.match(payload.sources[1].message!, /1 of 3/)
  assert.doesNotMatch(JSON.stringify(payload), /private upstream diagnostics/)
})

test('total outage retains last-known-good records and their success timestamp', async () => {
  let time = 1_000
  let fail = false
  const service = createLiveIntelService({ now: () => time, loadJson: async (url) => {
    if (fail) throw new Error('offline')
    return successfulData(url)
  } })
  const fresh = await service.get()
  time += CACHE_TTL_MS
  fail = true
  const stale = await service.get()
  assert.deepEqual(stale.kev, fresh.kev)
  assert.deepEqual(stale.news, fresh.news)
  assert.deepEqual(stale.advisories, fresh.advisories)
  assert.deepEqual(stale.sources.map((source) => source.status), ['stale', 'stale', 'stale'])
  assert.deepEqual(stale.sources.map((source) => source.lastSuccessAt), fresh.sources.map((source) => source.lastSuccessAt))
  assert.notEqual(stale.generatedAt, fresh.generatedAt)
})

test('partial refresh combines retained query results with fresh results from healthy peers', async () => {
  let time = 1_000
  let refresh = false
  const service = createLiveIntelService({ now: () => time, loadJson: async (url) => {
    if (url === CISA_URL || url === MSRC_URL || !refresh) return successfulData(url)
    if (url === NEWS_URLS[1]) throw new Error('outage')
    return { hits: [newsRecord({ objectID: String(200 + NEWS_URLS.indexOf(url)), created_at: '2026-09-21T12:30:00Z' })] }
  } })
  const first = await service.get()
  time += CACHE_TTL_MS
  refresh = true
  const second = await service.get()
  assert.deepEqual(second.news.map((item) => item.id), ['200', '202', '101'])
  assert.equal(second.sources[1].status, 'stale')
  assert.equal(second.sources[1].lastSuccessAt, first.sources[1].lastSuccessAt)
})

test('invalid upstream JSON structure cannot overwrite a previous valid snapshot', async () => {
  let time = 1_000
  let malformed = false
  const service = createLiveIntelService({ now: () => time, loadJson: async (url) => malformed ? { unexpected: true } : successfulData(url) })
  const first = await service.get()
  time += CACHE_TTL_MS
  malformed = true
  const second = await service.get()
  assert.deepEqual(second.kev, first.kev)
  assert.deepEqual(second.news, first.news)
  assert.deepEqual(second.advisories, first.advisories)
  assert.ok(second.sources.every((source) => source.status === 'stale'))
})

test('a fresh copy of a shared story takes precedence over a stale query copy', async () => {
  let time = 1_000
  let refresh = false
  const service = createLiveIntelService({ now: () => time, loadJson: async (url) => {
    if (url === CISA_URL || url === MSRC_URL) return successfulData(url)
    if (refresh && url === NEWS_URLS[0]) throw new Error('outage')
    return { hits: [newsRecord({ title: refresh ? 'Updated story' : 'Original story', points: refresh ? 99 : 1 })] }
  } })
  await service.get()
  time += CACHE_TTL_MS
  refresh = true
  const payload = await service.get()
  assert.equal(payload.news.length, 1)
  assert.equal(payload.news[0].title, 'Updated story')
  assert.equal(payload.news[0].points, 99)
  assert.equal(payload.sources[1].status, 'stale')
})

test('initial total outage is explicit, cached, and automatically recovers after TTL', async () => {
  let time = 1_000
  let fail = true
  let calls = 0
  const service = createLiveIntelService({ now: () => time, loadJson: async (url) => {
    calls++
    if (fail) throw new Error('unavailable')
    return successfulData(url)
  } })
  const failed = await service.get()
  assert.deepEqual(failed.kev, [])
  assert.deepEqual(failed.news, [])
  assert.deepEqual(failed.advisories, [])
  assert.ok(failed.sources.every((source) => source.status === 'error' && source.lastSuccessAt === undefined))
  assert.strictEqual(await service.get(), failed)
  assert.equal(calls, 5)
  fail = false
  time += CACHE_TTL_MS
  const recovered = await service.get()
  assert.ok(recovered.sources.every((source) => source.status === 'ok' && source.message === undefined))
  assert.equal(calls, 10)
})

test('a valid empty source replaces older records rather than preserving obsolete results', async () => {
  let time = 1_000
  let empty = false
  const service = createLiveIntelService({ now: () => time, loadJson: async (url) => {
    if (!empty) return successfulData(url)
    if (url === MSRC_URL) return { value: [] }
    return url === CISA_URL ? { vulnerabilities: [] } : { hits: [] }
  } })
  await service.get()
  time += CACHE_TTL_MS
  empty = true
  const payload = await service.get()
  assert.deepEqual(payload.kev, [])
  assert.deepEqual(payload.news, [])
  assert.deepEqual(payload.advisories, [])
  assert.ok(payload.sources.every((source) => source.status === 'ok' && source.count === 0))
})

test('callers cannot mutate a shared cached snapshot or its retained source data', async () => {
  let time = 1_000
  let offline = false
  const service = createLiveIntelService({ now: () => time, loadJson: async (url) => {
    if (offline) throw new Error('offline')
    return successfulData(url)
  } })
  const original = await service.get()
  const expected = structuredClone(original)
  for (const mutate of [
    () => { original.generatedAt = 'corrupted' },
    () => { original.kev[0].title = 'corrupted' },
    () => { original.news[0].url = 'https://attacker.example/' },
    () => { original.advisories[0].url = 'https://attacker.example/' },
    () => { original.sources[0].status = 'error' },
    () => { original.kev.splice(0) },
    () => { original.advisories.splice(0) },
    () => { original.sources.push(original.sources[0]) },
  ]) assert.throws(mutate, TypeError)
  assert.deepEqual(await service.get(), expected)
  time += CACHE_TTL_MS
  offline = true
  const stale = await service.get()
  assert.deepEqual(stale.kev, expected.kev)
  assert.deepEqual(stale.news, expected.news)
  assert.deepEqual(stale.advisories, expected.advisories)
})

test('a backwards wall-clock adjustment invalidates rather than prolongs a cached snapshot', async () => {
  let time = 3_600_000
  let calls = 0
  const service = createLiveIntelService({ now: () => time, loadJson: async (url) => { calls++; return successfulData(url) } })
  const first = await service.get()
  time -= 3_000_000
  const refreshed = await service.get()
  assert.notStrictEqual(refreshed, first)
  assert.equal(calls, 10)
  assert.equal(refreshed.generatedAt, new Date(time).toISOString())
  time += CACHE_TTL_MS - 1
  assert.strictEqual(await service.get(), refreshed)
  assert.equal(calls, 10)
})

test('separate server instances never share cached records, failures, or in-flight refreshes', async () => {
  let healthyCalls = 0
  let failingCalls = 0
  const healthy = createLiveIntelService({ loadJson: async (url) => { healthyCalls++; return successfulData(url) } })
  const failing = createLiveIntelService({ loadJson: async () => { failingCalls++; throw new Error('offline') } })
  const [available, unavailable] = await Promise.all([healthy.get(), failing.get()])
  assert.equal(available.kev.length, 1)
  assert.equal(available.news.length, 3)
  assert.equal(available.advisories.length, 1)
  assert.deepEqual(unavailable.kev, [])
  assert.deepEqual(unavailable.news, [])
  assert.deepEqual(unavailable.advisories, [])
  assert.ok(unavailable.sources.every((source) => source.status === 'error' && !source.lastSuccessAt))
  assert.strictEqual(await healthy.get(), available)
  assert.strictEqual(await failing.get(), unavailable)
  assert.equal(healthyCalls, 5)
  assert.equal(failingCalls, 5)
})

test('expired-cache callers share a failed refresh and release it for the next recovery', async () => {
  let time = 1_000
  let calls = 0
  let fail = false
  let release: (() => void) | undefined
  let gate = Promise.resolve()
  const service = createLiveIntelService({ now: () => time, loadJson: async (url) => {
    calls++
    await gate
    if (fail) throw new Error('offline')
    return successfulData(url)
  } })
  const first = await service.get()
  time += CACHE_TTL_MS
  fail = true
  gate = new Promise<void>((resolve) => { release = resolve })
  const requests = Array.from({ length: 12 }, () => service.get())
  assert.equal(calls, 10)
  assert.ok(requests.every((request) => request === requests[0]))
  release!()
  const stale = await Promise.all(requests)
  assert.ok(stale.every((snapshot) => snapshot === stale[0] && snapshot !== first))
  assert.ok(stale[0].sources.every((source) => source.status === 'stale'))
  assert.equal(calls, 10)
  time += CACHE_TTL_MS
  fail = false
  const recovered = await service.get()
  assert.ok(recovered.sources.every((source) => source.status === 'ok'))
  assert.equal(calls, 15)
})

test('MSRC failure is independent: retain its last successful snapshot while CISA and news keep updating', async () => {
  let time = Date.parse('2026-09-22T12:00:00Z')
  let mode: 'healthy' | 'offline' | 'malformed' = 'healthy'
  const service = createLiveIntelService({ now: () => time, loadJson: async (url) => {
    if (url !== MSRC_URL) return successfulData(url)
    if (mode === 'offline') throw new Error('private MSRC diagnostics')
    if (mode === 'malformed') return { value: [advisoryRecord({ ID: 'javascript:alert(1)' })] }
    return successfulData(url)
  } })
  const first = await service.get()
  for (const state of ['offline', 'malformed'] as const) {
    mode = state
    time += CACHE_TTL_MS
    const payload = await service.get()
    assert.deepEqual(payload.sources.map((source) => source.status), ['ok', 'ok', 'stale'])
    assert.deepEqual(payload.advisories, first.advisories)
    assert.equal(payload.sources[2].count, 1)
    assert.equal(payload.sources[2].lastSuccessAt, first.sources[2].lastSuccessAt)
    assert.notEqual(payload.sources[0].lastSuccessAt, first.sources[0].lastSuccessAt)
    assert.doesNotMatch(JSON.stringify(payload), /private MSRC diagnostics/)
  }
  mode = 'healthy'
  time += CACHE_TTL_MS
  const recovered = await service.get()
  assert.equal(recovered.sources[2].status, 'ok')
  assert.equal(recovered.sources[2].message, undefined)
  assert.equal(recovered.sources[2].lastSuccessAt, new Date(time).toISOString())
})

test('initial MSRC outage is explicit and does not prevent the two existing feeds', async () => {
  const service = createLiveIntelService({ loadJson: async (url) => {
    if (url === MSRC_URL) throw new Error('unavailable')
    return successfulData(url)
  } })
  const payload = await service.get()
  assert.deepEqual(payload.advisories, [])
  assert.equal(payload.kev.length, 1)
  assert.equal(payload.news.length, 3)
  assert.deepEqual(payload.sources.map((source) => source.status), ['ok', 'ok', 'error'])
  assert.equal(payload.sources[2].lastSuccessAt, undefined)
  assert.equal(payload.sources[2].count, 0)
})

test('a healthy MSRC source remains available during CISA and community search outages', async () => {
  const service = createLiveIntelService({ loadJson: async (url) => {
    if (url === MSRC_URL) return successfulData(url)
    throw new Error('unavailable')
  } })
  const payload = await service.get()
  assert.deepEqual(payload.sources.map((source) => source.status), ['error', 'error', 'ok'])
  assert.equal(payload.advisories.length, 1)
  assert.equal(payload.sources[2].count, 1)
  assert.equal(payload.kev.length, 0)
  assert.equal(payload.news.length, 0)
})
