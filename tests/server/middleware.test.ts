import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import test, { type TestContext } from 'node:test'
import { createLiveIntelMiddleware } from '../../server/middleware.ts'
import type { LiveIntelPayload } from '../../shared/live-intel.ts'

const payload: LiveIntelPayload = { generatedAt: '2026-09-22T00:00:00.000Z', pollAfterMs: 60_000, cacheTtlMs: 60_000, sources: [], kev: [], news: [] }

async function start(t: TestContext, getPayload: () => Promise<LiveIntelPayload> = async () => payload) {
  const middleware = createLiveIntelMiddleware(getPayload)
  const server = createServer((request, response) => {
    void middleware(request, response, () => { response.statusCode = 404; response.end('Not found') })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections()
    server.close((error) => error ? reject(error) : resolve())
  }))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

test('GET returns typed JSON with no-store and nosniff headers', async (t) => {
  const base = await start(t)
  const response = await fetch(`${base}/api/live-intel`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.deepEqual(await response.json(), payload)
})

test('route allows query strings but never prefix matches another resource', async (t) => {
  let calls = 0
  const base = await start(t, async () => { calls++; return payload })
  assert.equal((await fetch(`${base}/api/live-intel?refresh=1`)).status, 200)
  for (const path of ['/api/live-intel-extra', '/api/live-intel/child', '/api/live-intel/', '/api/other']) {
    assert.equal((await fetch(`${base}${path}`)).status, 404)
  }
  assert.equal(calls, 1)
})

test('HEAD has the GET representation headers without a response body', async (t) => {
  const base = await start(t)
  const response = await fetch(`${base}/api/live-intel`, { method: 'HEAD' })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-length'), String(Buffer.byteLength(JSON.stringify(payload))))
  assert.equal(await response.text(), '')
})

test('non-read methods are rejected without fetching upstream sources', async (t) => {
  let calls = 0
  const base = await start(t, async () => { calls++; return payload })
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const response = await fetch(`${base}/api/live-intel`, { method })
    assert.equal(response.status, 405)
    assert.equal(response.headers.get('allow'), 'GET, HEAD')
    assert.deepEqual(await response.json(), { error: 'Method not allowed' })
  }
  assert.equal(calls, 0)
})

test('unexpected service failures produce a safe generic 503 response', async (t) => {
  const base = await start(t, async () => { throw new Error('secret /internal/file stack trace') })
  const response = await fetch(`${base}/api/live-intel`)
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), { error: 'Live intelligence is temporarily unavailable.' })
  const head = await fetch(`${base}/api/live-intel`, { method: 'HEAD' })
  assert.equal(head.status, 503)
  assert.equal(await head.text(), '')
})
