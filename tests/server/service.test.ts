import assert from 'node:assert/strict'
import test from 'node:test'
import { createLiveIntelService } from '../../server/live-intel.ts'
import { CACHE_TTL_MS, CISA_NAME, CISA_URL, NEWS_NAME, NEWS_URLS } from '../../server/sources.ts'
import { kevRecord, newsRecord } from './fixtures.ts'

function successfulData(url: string) {
  return url === CISA_URL ? { vulnerabilities: [kevRecord()] } : { hits: [newsRecord({ objectID: String(100 + NEWS_URLS.indexOf(url)) })] }
}

test('simultaneous callers share one four-request upstream refresh', async () => {
  const pending = new Map<string, (value: unknown) => void>()
  let calls = 0
  const service = createLiveIntelService({ loadJson: (url) => { calls++; return new Promise((resolve) => pending.set(url, resolve)) } })
  const requests = Array.from({ length: 20 }, () => service.get())
  assert.equal(calls, 4)
  assert.strictEqual(requests[0], requests[19])
  for (const [url, resolve] of pending) resolve(successfulData(url))
  const payloads = await Promise.all(requests)
  assert.ok(payloads.every((payload) => payload === payloads[0]))
  assert.equal(payloads[0].kev.length, 1)
  assert.equal(payloads[0].news.length, 3)
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
  assert.equal(calls, 4)
  time++
  assert.notStrictEqual(await service.get(), first)
  assert.equal(calls, 8)
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
  assert.deepEqual(stale.sources.map((source) => source.status), ['stale', 'stale'])
  assert.deepEqual(stale.sources.map((source) => source.lastSuccessAt), fresh.sources.map((source) => source.lastSuccessAt))
  assert.notEqual(stale.generatedAt, fresh.generatedAt)
})

test('partial refresh combines retained query results with fresh results from healthy peers', async () => {
  let time = 1_000
  let refresh = false
  const service = createLiveIntelService({ now: () => time, loadJson: async (url) => {
    if (url === CISA_URL || !refresh) return successfulData(url)
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
  assert.ok(second.sources.every((source) => source.status === 'stale'))
})

test('a fresh copy of a shared story takes precedence over a stale query copy', async () => {
  let time = 1_000
  let refresh = false
  const service = createLiveIntelService({ now: () => time, loadJson: async (url) => {
    if (url === CISA_URL) return successfulData(url)
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
  assert.ok(failed.sources.every((source) => source.status === 'error' && source.lastSuccessAt === undefined))
  assert.strictEqual(await service.get(), failed)
  assert.equal(calls, 4)
  fail = false
  time += CACHE_TTL_MS
  const recovered = await service.get()
  assert.ok(recovered.sources.every((source) => source.status === 'ok' && source.message === undefined))
  assert.equal(calls, 8)
})

test('a valid empty source replaces older records rather than preserving obsolete results', async () => {
  let time = 1_000
  let empty = false
  const service = createLiveIntelService({ now: () => time, loadJson: async (url) => {
    if (!empty) return successfulData(url)
    return url === CISA_URL ? { vulnerabilities: [] } : { hits: [] }
  } })
  await service.get()
  time += CACHE_TTL_MS
  empty = true
  const payload = await service.get()
  assert.deepEqual(payload.kev, [])
  assert.deepEqual(payload.news, [])
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
    () => { original.sources[0].status = 'error' },
    () => { original.kev.splice(0) },
    () => { original.sources.push(original.sources[0]) },
  ]) assert.throws(mutate, TypeError)
  assert.deepEqual(await service.get(), expected)
  time += CACHE_TTL_MS
  offline = true
  const stale = await service.get()
  assert.deepEqual(stale.kev, expected.kev)
  assert.deepEqual(stale.news, expected.news)
})

test('a backwards wall-clock adjustment invalidates rather than prolongs a cached snapshot', async () => {
  let time = 3_600_000
  let calls = 0
  const service = createLiveIntelService({ now: () => time, loadJson: async (url) => { calls++; return successfulData(url) } })
  const first = await service.get()
  time -= 3_000_000
  const refreshed = await service.get()
  assert.notStrictEqual(refreshed, first)
  assert.equal(calls, 8)
  assert.equal(refreshed.generatedAt, new Date(time).toISOString())
  time += CACHE_TTL_MS - 1
  assert.strictEqual(await service.get(), refreshed)
  assert.equal(calls, 8)
})
