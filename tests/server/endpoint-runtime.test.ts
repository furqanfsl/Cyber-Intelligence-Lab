import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { request, type IncomingHttpHeaders } from 'node:http'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
import test, { type TestContext } from 'node:test'
import { createAppServer } from '../../app-server/server.ts'
import { createEndpointMiddleware } from '../../backend/endpoint-middleware.ts'

const TOKEN = 'b'.repeat(64)
const CLIENT = { 'x-cyber-lab-endpoint-client': '1' }

async function runtimeFixture(t: TestContext, privateFixture = true) {
  const directory = await mkdtemp(join(tmpdir(), 'cyber-endpoint-runtime-'))
  const distDir = join(directory, 'dist')
  await mkdir(distDir)
  await writeFile(join(distDir, 'index.html'), '<!doctype html><title>Endpoint runtime fixture</title>')
  const calls = { public: 0, status: 0, start: [] as { includeSysmon: boolean }[], stop: 0 }
  const monitor = {
    getSnapshot() { calls.status++; return { status: 'running', syntheticPrivateMarker: 'runtime-private-fixture' } },
    async start(options: { includeSysmon: boolean }) { calls.start.push(options); return { status: 'running' } },
    stop() { calls.stop++; return { status: 'stopped', events: [], findings: [] } },
  }
  const server = createAppServer({
    distDir,
    liveIntelMiddleware: (_incoming, response) => { calls.public++; response.setHeader('content-type', 'application/json'); response.end('{"syntheticPublicFixture":true}') },
    ...(privateFixture ? { endpointMiddleware: createEndpointMiddleware(monitor, { enabled: true, platform: 'win32', randomToken: () => TOKEN }) } : {}),
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.closeAllConnections()
      server.close((error) => error ? reject(error) : resolve())
    })
    // The cleanup target is exactly the unique directory created above, not a
    // caller-supplied path. Revalidate that it remains inside the named temp root.
    const withinTemp = relative(tmpdir(), directory)
    assert.ok(!isAbsolute(withinTemp) && !withinTemp.startsWith(`..${sep}`) && withinTemp !== '..' && withinTemp.startsWith('cyber-endpoint-runtime-'))
    await rm(directory, { recursive: true, force: true })
  })
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const port = address.port
  const origin = `http://127.0.0.1:${port}`
  const protectedHeaders = { ...CLIENT, 'x-cyber-lab-endpoint-token': TOKEN }
  const postHeaders = { ...protectedHeaders, origin, 'content-type': 'application/json' }
  function send(path: string, method = 'GET', headers: Record<string, string> = {}, body?: string) {
    return new Promise<{ status: number; body: string; headers: IncomingHttpHeaders }>((resolve, reject) => {
      const outgoing = request({ hostname: '127.0.0.1', port, path, method, headers }, (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => { chunks.push(chunk) })
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), headers: response.headers }))
      })
      outgoing.on('error', reject)
      outgoing.end(body)
    })
  }
  return { calls, send, protectedHeaders, postHeaders, origin }
}

test('production runtime routes guarded endpoint JSON POSTs before the public GET-only guard', async (t) => {
  const { calls, send, postHeaders, protectedHeaders } = await runtimeFixture(t)
  const start = await send('/api/endpoint/start', 'POST', postHeaders, '{"includeSysmon":true}')
  assert.equal(start.status, 200)
  assert.deepEqual(JSON.parse(start.body), { status: 'running' })
  assert.deepEqual(calls.start, [{ includeSysmon: true }])
  const status = await send('/api/endpoint/status', 'GET', protectedHeaders)
  assert.equal(status.status, 200)
  assert.deepEqual(JSON.parse(status.body), { status: 'running', syntheticPrivateMarker: 'runtime-private-fixture' })
  const stop = await send('/api/endpoint/stop', 'POST', postHeaders, '{}')
  assert.equal(stop.status, 200)
  assert.deepEqual(JSON.parse(stop.body), { status: 'stopped', events: [], findings: [] })
  assert.deepEqual(calls, { public: 0, status: 1, start: [{ includeSysmon: true }], stop: 1 })
})

test('private runtime responses retain local-only, no-store and frame-denial protections', async (t) => {
  const { send, protectedHeaders } = await runtimeFixture(t)
  const response = await send('/api/endpoint/status', 'GET', protectedHeaders)
  assert.equal(response.status, 200)
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.equal(response.headers['x-content-type-options'], 'nosniff')
  assert.equal(response.headers['x-frame-options'], 'DENY')
  assert.equal(response.headers['content-security-policy'], "default-src 'none'; frame-ancestors 'none'")
  assert.equal(response.headers['access-control-allow-origin'], undefined)
  assert.equal(response.headers['referrer-policy'], 'no-referrer')
  assert.doesNotMatch(response.body, new RegExp(TOKEN))
})

test('embedded runtime is unavailable by default without an explicit endpoint opt-in', async (t) => {
  const { calls, send } = await runtimeFixture(t, false)
  const session = await send('/api/endpoint/session', 'GET', CLIENT)
  assert.equal(session.status, 200)
  const payload = JSON.parse(session.body)
  assert.equal(payload.available, false)
  assert.match(payload.token, /^[a-f0-9]{64}$/)
  assert.equal((await send('/api/endpoint/status', 'GET', { ...CLIENT, 'x-cyber-lab-endpoint-token': payload.token })).status, 503)
  assert.deepEqual(calls, { public: 0, status: 0, start: [], stop: 0 })
})

test('the existing static page, health route and public intelligence remain independent', async (t) => {
  const { calls, send } = await runtimeFixture(t)
  const homepage = await send('/')
  assert.equal(homepage.status, 200)
  assert.match(homepage.body, /Endpoint runtime fixture/)
  assert.match(String(homepage.headers['content-security-policy']), /connect-src 'self'/)
  const health = await send('/healthz')
  assert.equal(health.status, 200)
  assert.deepEqual(JSON.parse(health.body), { status: 'ok' })
  const publicSource = await send('/api/live-intel')
  assert.equal(publicSource.status, 200)
  assert.deepEqual(JSON.parse(publicSource.body), { syntheticPublicFixture: true })
  assert.deepEqual(calls, { public: 1, status: 0, start: [], stop: 0 })
})

test('public routes continue rejecting mutation methods and request bodies before source work', async (t) => {
  const { calls, send } = await runtimeFixture(t)
  for (const path of ['/', '/healthz', '/api/live-intel']) {
    assert.equal((await send(path, 'POST', { 'content-type': 'application/json' }, '{}')).status, 405)
    assert.equal((await send(path, 'GET', { 'content-length': '2' }, '{}')).status, 400)
  }
  assert.deepEqual(calls, { public: 0, status: 0, start: [], stop: 0 })
})

test('encoded or normalized private path aliases do not escape exact endpoint routing', async (t) => {
  const { calls, send, postHeaders } = await runtimeFixture(t)
  for (const path of ['/api/%65ndpoint/start', '/api/endpoint/%73tart', '/api/endpoint/./start', '/api/endpoint//start', '/api/endpoint/start/', '/api/endpoint/start-extra', '/api/endpoint/scan', '/api/endpoint/quarantine', 'http://example.com/api/endpoint/start']) {
    const response = await send(path, 'POST', postHeaders, '{"includeSysmon":false}')
    assert.ok([400, 403, 404].includes(response.status), `${path}: ${response.status}`)
  }
  assert.deepEqual(calls, { public: 0, status: 0, start: [], stop: 0 })
})

test('a public Origin or spoofed Host cannot read private status through the production wrapper', async (t) => {
  const { calls, send, protectedHeaders, origin } = await runtimeFixture(t)
  for (const headers of [
    { ...protectedHeaders, origin: 'https://example.com' },
    { ...protectedHeaders, host: origin.replace('http://127.0.0.1:', 'evil.example:'), origin: origin.replace('127.0.0.1', 'evil.example') },
    { ...protectedHeaders, 'sec-fetch-site': 'cross-site' },
  ]) {
    const response = await send('/api/endpoint/status', 'GET', headers)
    assert.equal(response.status, 403)
    assert.doesNotMatch(response.body, /runtime-private-fixture/)
  }
  assert.deepEqual(calls, { public: 0, status: 0, start: [], stop: 0 })
})
