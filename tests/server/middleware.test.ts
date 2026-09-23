import assert from 'node:assert/strict'
import { createServer, IncomingMessage, request, ServerResponse } from 'node:http'
import { Socket, type AddressInfo } from 'node:net'
import test, { type TestContext } from 'node:test'
import { createLiveIntelMiddleware } from '../../server/middleware.ts'
import type { LiveIntelPayload } from '../../shared/live-intel.ts'

const payload: LiveIntelPayload = { generatedAt: '2026-09-22T00:00:00.000Z', pollAfterMs: 60_000, cacheTtlMs: 60_000, sources: [], kev: [], news: [], advisories: [] }

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

test('raw encoded, normalized, and absolute-form paths cannot alias the intelligence route', async (t) => {
  let calls = 0
  const base = new URL(await start(t, async () => { calls++; return payload }))
  for (const path of ['/api/%6cive-intel', '/api//live-intel', '/api/./live-intel', '/api/live-intel%3Frefresh=1', 'http://example.com/api/live-intel']) {
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ hostname: base.hostname, port: base.port, path }, (response) => {
        response.resume()
        response.on('end', () => resolve(response.statusCode ?? 0))
      })
      req.on('error', reject)
      req.end()
    })
    assert.equal(status, 404, path)
  }
  assert.equal(calls, 0)
  const allowed = await fetch(new URL('/api/live-intel?source=http://127.0.0.1/private', base))
  assert.equal(allowed.status, 200)
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

test('disconnected clients neither start new work nor receive late success or error writes', async (t) => {
  function connection() {
    const incoming = new IncomingMessage(new Socket())
    incoming.url = '/api/live-intel'
    incoming.method = 'GET'
    return { incoming, response: new ServerResponse(incoming) }
  }
  let calls = 0
  const closed = connection()
  closed.response.destroy()
  await createLiveIntelMiddleware(async () => { calls++; return payload })(closed.incoming, closed.response, () => {})
  assert.equal(calls, 0)
  for (const failed of [false, true]) {
    const { incoming, response } = connection()
    let complete: ((value: LiveIntelPayload) => void) | undefined
    let fail: ((error: Error) => void) | undefined
    const gate = new Promise<LiveIntelPayload>((resolve, reject) => { complete = resolve; fail = reject })
    const headers = t.mock.method(response, 'setHeader')
    const end = t.mock.method(response, 'end')
    const pending = createLiveIntelMiddleware(() => gate)(incoming, response, () => {})
    const initialHeaders = headers.mock.callCount()
    response.destroy()
    if (failed) fail!(new Error('upstream failed after disconnect'))
    else complete!(payload)
    await pending
    assert.equal(headers.mock.callCount(), initialHeaders)
    assert.equal(end.mock.callCount(), 0)
  }
})
