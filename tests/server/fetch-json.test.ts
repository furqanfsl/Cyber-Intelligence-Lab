import assert from 'node:assert/strict'
import test from 'node:test'
import { createJsonLoader } from '../../server/fetch-json.ts'
import { CISA_URL, NEWS_URLS } from '../../server/sources.ts'

test('transport rejects limits that disable bounds or overflow Node timers', () => {
  for (const timeoutMs of [0, -1, 0.5, NaN, Infinity, 2_147_483_648]) {
    assert.throws(() => createJsonLoader({ timeoutMs }), /timeoutMs/)
  }
  for (const maxBytes of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createJsonLoader({ maxBytes }), /maxBytes/)
  }
})

test('transport only permits exact fixed source URLs and disables redirects', async () => {
  const calls: string[] = []
  const load = createJsonLoader({ fetchImpl: async (url, options) => {
    calls.push(String(url))
    assert.equal(options?.redirect, 'error')
    assert.equal(new Headers(options?.headers).get('accept'), 'application/json')
    assert.ok(options?.signal)
    return Response.json({ valid: true })
  } })
  for (const url of [CISA_URL, ...NEWS_URLS]) assert.deepEqual(await load(url), { valid: true })
  for (const url of ['http://localhost/', 'https://example.com/', `${CISA_URL}?redirect=x`, 'file:///etc/passwd']) {
    await assert.rejects(load(url), /not allowed/)
  }
  assert.equal(calls.length, 4)
})

test('transport decodes chunked UTF-8 without corrupting split multi-byte characters', async () => {
  const bytes = new TextEncoder().encode('{"title":"café 🔐"}')
  const load = createJsonLoader({ fetchImpl: async () => new Response(new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
      controller.close()
    },
  })) })
  assert.deepEqual(await load(CISA_URL), { title: 'café 🔐' })
})

test('transport rejects non-success status without exposing the remote status text', async () => {
  const load = createJsonLoader({ fetchImpl: async () => new Response('private diagnostics', { status: 503, statusText: 'private token' }) })
  await assert.rejects(load(CISA_URL), { message: 'Source request failed' })
})

test('transport rejects an oversized content-length before reading the body', async () => {
  let cancelled = false
  const load = createJsonLoader({ maxBytes: 4, fetchImpl: async () => new Response(new ReadableStream({ cancel() { cancelled = true } }), { headers: { 'content-length': '100' } }) })
  await assert.rejects(load(CISA_URL), /size limit/)
  assert.equal(cancelled, true)
})

test('transport enforces byte limit even when content-length is missing or dishonest', async () => {
  for (const headers of [new Headers(), new Headers({ 'content-length': '1' })]) {
    let cancelled = false
    const load = createJsonLoader({ maxBytes: 5, fetchImpl: async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('123456')) },
      cancel() { cancelled = true },
    }), { headers }) })
    await assert.rejects(load(CISA_URL), /size limit/)
    assert.equal(cancelled, true)
  }
})

test('transport rejects empty and non-JSON successful responses', async () => {
  for (const response of [new Response(null), new Response('<html>Error</html>'), new Response('')]) {
    const load = createJsonLoader({ fetchImpl: async () => response })
    await assert.rejects(load(CISA_URL))
  }
})

test('transport timeout aborts an upstream fetch that never responds', async () => {
  let aborted = false
  const load = createJsonLoader({ timeoutMs: 5, fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
    options!.signal!.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')) }, { once: true })
  }) })
  await assert.rejects(load(CISA_URL), /aborted/)
  assert.equal(aborted, true)
})

test('transport deadline also covers a body stalled after response headers', async () => {
  const load = createJsonLoader({ timeoutMs: 5, fetchImpl: async (_url, options) => new Response(new ReadableStream({
    start(controller) {
      options!.signal!.addEventListener('abort', () => controller.error(new Error('body aborted')), { once: true })
    },
  })) })
  await assert.rejects(load(CISA_URL), /body aborted/)
})
