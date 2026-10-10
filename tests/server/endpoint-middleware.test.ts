import assert from 'node:assert/strict'
import { createServer, IncomingMessage, request, ServerResponse, type IncomingHttpHeaders } from 'node:http'
import { Socket, type AddressInfo } from 'node:net'
import test, { type TestContext } from 'node:test'
import { createEndpointMiddleware } from '../../backend/endpoint-middleware.ts'

const TOKEN = 'a'.repeat(64)
const PRIVATE_SNAPSHOT = { running: true, syntheticPrivateMarker: 'synthetic-device-only' }
const CLIENT = { 'x-cyber-lab-endpoint-client': '1' }

function monitorFixture() {
  const calls = { status: 0, start: [] as { includeSysmon: boolean }[], stop: 0 }
  return {
    calls,
    monitor: {
      getSnapshot() { calls.status++; return PRIVATE_SNAPSHOT },
      async start(options: { includeSysmon: boolean }) { calls.start.push(options); return PRIVATE_SNAPSHOT },
      stop() { calls.stop++; return { running: false } },
    },
  }
}

async function fixture(t: TestContext, options: { enabled?: boolean; platform?: string; bodyTimeoutMs?: number } = {}, failingStart = false) {
  const { monitor, calls } = monitorFixture()
  if (failingStart) monitor.start = async () => { throw new Error('private-account private-path private-exception') }
  const middleware = createEndpointMiddleware(monitor, {
    enabled: options.enabled ?? true,
    platform: options.platform ?? 'win32',
    randomToken: () => TOKEN,
    ...(options.bodyTimeoutMs === undefined ? {} : { bodyTimeoutMs: options.bodyTimeoutMs }),
  })
  const server = createServer((incoming, response) => {
    // Simulate Vite's readiness CORS policy. Private routes must override it.
    response.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5500')
    response.setHeader('Access-Control-Allow-Credentials', 'true')
    response.setHeader('Access-Control-Allow-Headers', '*')
    response.setHeader('Access-Control-Allow-Methods', '*')
    void middleware(incoming, response, () => { response.statusCode = 404; response.end('unrelated route') })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections()
    server.close((error) => error ? reject(error) : resolve())
  }))
  const port = (server.address() as AddressInfo).port
  const origin = `http://127.0.0.1:${port}`
  function send(path = '/api/endpoint/session', method = 'GET', headers: Record<string, string> = CLIENT, body?: string) {
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
  const protectedHeaders = { ...CLIENT, 'x-cyber-lab-endpoint-token': TOKEN }
  const postHeaders = { ...protectedHeaders, origin, 'content-type': 'application/json' }
  return { calls, send, origin, port, protectedHeaders, postHeaders }
}

test('endpoint availability bootstrap is explicit, bounded and does not read private sources', async (t) => {
  const { calls, send } = await fixture(t)
  const response = await send()
  assert.equal(response.status, 200)
  assert.deepEqual(JSON.parse(response.body), { token: TOKEN, platform: 'win32', available: true })
  assert.deepEqual(calls, { status: 0, start: [], stop: 0 })
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.equal(response.headers['x-content-type-options'], 'nosniff')
  assert.equal(response.headers['x-frame-options'], 'DENY')
  assert.match(String(response.headers['content-security-policy']), /frame-ancestors 'none'/)
  for (const header of ['access-control-allow-origin', 'access-control-allow-credentials', 'access-control-allow-headers', 'access-control-allow-methods']) {
    assert.equal(response.headers[header], undefined, header)
  }
})

test('session rejects ordinary navigations and unguarded bootstrap reads', async (t) => {
  const { calls, send } = await fixture(t)
  for (const headers of [{}, { 'sec-fetch-site': 'same-origin' }, { 'x-cyber-lab-endpoint-client': '0' }] as Record<string, string>[]) {
    const response = await send('/api/endpoint/session', 'GET', headers)
    assert.equal(response.status, 403)
    assert.doesNotMatch(response.body, new RegExp(TOKEN))
  }
  assert.deepEqual(calls, { status: 0, start: [], stop: 0 })
})

test('non-Windows or explicitly disabled configurations advertise no collector and cannot collect', async (t) => {
  for (const options of [{ platform: 'linux' }, { platform: 'darwin' }, { enabled: false }]) {
    const { calls, send, protectedHeaders, postHeaders } = await fixture(t, options)
    const session = await send()
    assert.equal(session.status, 200)
    assert.equal(JSON.parse(session.body).available, false)
    for (const [path, method, headers, body] of [
      ['/api/endpoint/status', 'GET', protectedHeaders, undefined],
      ['/api/endpoint/start', 'POST', postHeaders, '{"includeSysmon":false}'],
    ] as const) {
      const response = await send(path, method, headers, body)
      assert.equal(response.status, 503)
      assert.equal(JSON.parse(response.body).code, 'endpoint_unavailable')
    }
    assert.deepEqual(calls, { status: 0, start: [], stop: 0 })
  }
})

test('private status requires the process token and never leaks it or the snapshot on rejection', async (t) => {
  const { calls, send, protectedHeaders } = await fixture(t)
  for (const token of [undefined, '', 'b'.repeat(64), TOKEN.slice(1), `${TOKEN}, ${TOKEN}`]) {
    const headers = { ...CLIENT, ...(token === undefined ? {} : { 'x-cyber-lab-endpoint-token': token }) }
    const response = await send('/api/endpoint/status', 'GET', headers)
    assert.equal(response.status, 403)
    assert.equal(JSON.parse(response.body).code, 'endpoint_session_required')
    assert.doesNotMatch(response.body, /synthetic-device-only/)
  }
  assert.equal(calls.status, 0)
  const allowed = await send('/api/endpoint/status', 'GET', protectedHeaders)
  assert.equal(allowed.status, 200)
  assert.deepEqual(JSON.parse(allowed.body), PRIVATE_SNAPSHOT)
  assert.equal(calls.status, 1)
  assert.doesNotMatch(allowed.body, new RegExp(TOKEN))
})

test('private endpoints reject other origins even if they somehow know the token', async (t) => {
  const { calls, send, origin, protectedHeaders, postHeaders } = await fixture(t)
  for (const rejectedOrigin of ['https://example.com', 'null', origin.replace('http:', 'https:'), `${origin}1`, 'http://127.0.0.1:5500']) {
    for (const [path, method, headers, body] of [
      ['/api/endpoint/session', 'GET', CLIENT, undefined],
      ['/api/endpoint/status', 'GET', protectedHeaders, undefined],
      ['/api/endpoint/start', 'POST', postHeaders, '{"includeSysmon":false}'],
      ['/api/endpoint/stop', 'POST', postHeaders, '{}'],
    ] as const) {
      const response = await send(path, method, { ...headers, origin: rejectedOrigin }, body)
      assert.equal(response.status, 403, `${method} ${path}: ${rejectedOrigin}`)
      assert.equal(JSON.parse(response.body).code, 'endpoint_local_only')
      assert.doesNotMatch(response.body, /synthetic-device-only/)
      assert.equal(response.headers['access-control-allow-origin'], undefined)
    }
  }
  assert.deepEqual(calls, { status: 0, start: [], stop: 0 })
})

test('fetch metadata must be same-origin, not merely same-site or a top-level navigation', async (t) => {
  const { calls, send, protectedHeaders, postHeaders } = await fixture(t)
  for (const site of ['cross-site', 'same-site', 'none', '']) {
    for (const [path, method, headers, body] of [
      ['/api/endpoint/session', 'GET', CLIENT, undefined],
      ['/api/endpoint/status', 'GET', protectedHeaders, undefined],
      ['/api/endpoint/start', 'POST', postHeaders, '{"includeSysmon":false}'],
    ] as const) {
      const response = await send(path, method, { ...headers, 'sec-fetch-site': site }, body)
      assert.equal(response.status, 403, `${site}: ${method} ${path}`)
    }
  }
  assert.deepEqual(calls, { status: 0, start: [], stop: 0 })
  assert.equal((await send('/api/endpoint/status', 'GET', { ...protectedHeaders, 'sec-fetch-site': 'same-origin' })).status, 200)
})

test('DNS rebinding, a non-loopback Host and mismatched local ports are rejected before source access', async (t) => {
  const { calls, send, port, protectedHeaders } = await fixture(t)
  for (const host of [`evil.example:${port}`, `192.0.2.1:${port}`, `127.0.0.1:${port === 65535 ? port - 1 : port + 1}`, '127.0.0.1', `localhost.:${port}`, `127.0.0.1:${port},evil.example`, `user@127.0.0.1:${port}`, `0.0.0.0:${port}`]) {
    const response = await send('/api/endpoint/status', 'GET', { ...protectedHeaders, host, origin: `http://${host}` })
    assert.equal(response.status, 403, host)
    assert.equal(JSON.parse(response.body).code, 'endpoint_local_only')
  }
  assert.equal(calls.status, 0)
  assert.equal((await send('/api/endpoint/status', 'GET', { ...protectedHeaders, host: `localhost:${port}` })).status, 200)
})

test('a loopback Host cannot override a non-loopback local or remote socket address', async (t) => {
  for (const addresses of [
    { remoteAddress: '192.0.2.1', localAddress: '127.0.0.1' },
    { remoteAddress: '127.0.0.1', localAddress: '192.0.2.1' },
    { remoteAddress: undefined, localAddress: '127.0.0.1' },
    { remoteAddress: '::1', localAddress: undefined },
  ]) {
    const { calls, monitor } = monitorFixture()
    const socket = new Socket()
    for (const [key, value] of Object.entries({ ...addresses, localPort: 5173 })) {
      Object.defineProperty(socket, key, { value, configurable: true })
    }
    const incoming = new IncomingMessage(socket)
    incoming.url = '/api/endpoint/status'
    incoming.method = 'GET'
    incoming.headers = { ...CLIENT, host: '127.0.0.1:5173', 'x-cyber-lab-endpoint-token': TOKEN }
    const response = new ServerResponse(incoming)
    const end = t.mock.method(response, 'end', () => response)
    await createEndpointMiddleware(monitor, { enabled: true, platform: 'win32', randomToken: () => TOKEN })(incoming, response, () => assert.fail('private request fell through'))
    assert.equal(response.statusCode, 403)
    assert.equal(JSON.parse(String(end.mock.calls[0].arguments[0])).code, 'endpoint_local_only')
    assert.deepEqual(calls, { status: 0, start: [], stop: 0 })
    socket.destroy()
  }
})

test('start accepts only an explicit boolean Sysmon option and a same-origin JSON POST', async (t) => {
  const { calls, send, postHeaders } = await fixture(t)
  for (const includeSysmon of [false, true]) {
    const response = await send('/api/endpoint/start', 'POST', postHeaders, JSON.stringify({ includeSysmon }))
    assert.equal(response.status, 200)
    assert.deepEqual(JSON.parse(response.body), PRIVATE_SNAPSHOT)
  }
  assert.deepEqual(calls.start, [{ includeSysmon: false }, { includeSysmon: true }])
  assert.equal(calls.status, 0)
})

test('mutations reject absent Origin, token or client marker without triggering the collector', async (t) => {
  const { calls, send, postHeaders } = await fixture(t)
  for (const missing of ['origin', 'x-cyber-lab-endpoint-token', 'x-cyber-lab-endpoint-client']) {
    const headers: Record<string, string> = { ...postHeaders }
    delete headers[missing]
    for (const [path, body] of [['/api/endpoint/start', '{"includeSysmon":false}'], ['/api/endpoint/stop', '{}']]) {
      const response = await send(path, 'POST', headers, body)
      assert.equal(response.status, 403, `${missing}: ${path}`)
    }
  }
  assert.deepEqual(calls, { status: 0, start: [], stop: 0 })
})

test('invalid bodies and unexpected options cannot enter the fixed collector command', async (t) => {
  const { calls, send, postHeaders } = await fixture(t)
  for (const body of ['', '{', 'null', '[]', '{}', '{"includeSysmon":"true"}', '{"includeSysmon":1}', '{"includeSysmon":false,"includeSysmon":true}', '{"includeSysmon":false,"computerName":"remote-host"}', '{"includeSysmon":false,"command":"Get-Content private-file"}', '{"includeSysmon":false,"__proto__":{}}']) {
    const response = await send('/api/endpoint/start', 'POST', postHeaders, body)
    assert.equal(response.status, 400, body)
    assert.doesNotMatch(response.body, /private-file|remote-host/)
  }
  assert.deepEqual(calls, { status: 0, start: [], stop: 0 })
})

test('private POSTs reject simple-form media types and oversized fixed JSON bodies', async (t) => {
  const { calls, send, postHeaders } = await fixture(t)
  for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', 'application/jsonp']) {
    const response = await send('/api/endpoint/start', 'POST', { ...postHeaders, 'content-type': contentType }, '{"includeSysmon":false}')
    assert.equal(response.status, 415, contentType)
  }
  const response = await send('/api/endpoint/start', 'POST', postHeaders, `{"includeSysmon":false,"padding":"${'x'.repeat(2_048)}"}`)
  assert.equal(response.status, 413)
  assert.deepEqual(calls, { status: 0, start: [], stop: 0 })
})

test('stop requires an empty object and clears through the monitor without collecting', async (t) => {
  const { calls, send, postHeaders } = await fixture(t)
  for (const body of ['', 'null', '[]', '{"includeSysmon":false}', '{"command":"Remove-Item"}']) {
    const response = await send('/api/endpoint/stop', 'POST', postHeaders, body)
    assert.equal(response.status, 400)
  }
  const response = await send('/api/endpoint/stop', 'POST', postHeaders, '{}')
  assert.equal(response.status, 200)
  assert.deepEqual(JSON.parse(response.body), { running: false })
  assert.deepEqual(calls, { status: 0, start: [], stop: 1 })
})

test('private API paths are exact and normalized or encoded aliases never start the collector', async (t) => {
  const { calls, send, postHeaders } = await fixture(t)
  for (const path of ['/api/endpoint/start-extra', '/api/endpoint/start/', '/api/endpoint//start', '/api/endpoint/./start', '/api/endpoint/%73tart', '/api/endpoint/start%3Ffoo', '/api/endpoint/unknown', 'http://example.com/api/endpoint/start']) {
    const response = await send(path, 'POST', postHeaders, '{"includeSysmon":false}')
    assert.equal(response.status, 404, path)
  }
  assert.deepEqual(calls, { status: 0, start: [], stop: 0 })
})

test('unsupported methods cannot collect and unrelated paths still reach the next handler', async (t) => {
  const { calls, send, protectedHeaders, postHeaders } = await fixture(t)
  for (const [path, method] of [
    ['/api/endpoint/session', 'POST'], ['/api/endpoint/session', 'HEAD'],
    ['/api/endpoint/status', 'POST'], ['/api/endpoint/status', 'OPTIONS'],
    ['/api/endpoint/start', 'GET'], ['/api/endpoint/start', 'PUT'],
    ['/api/endpoint/stop', 'GET'], ['/api/endpoint/stop', 'DELETE'],
  ]) {
    const response = await send(path, method, method === 'GET' ? protectedHeaders : postHeaders)
    assert.equal(response.status, 405, `${method} ${path}`)
  }
  const unrelated = await send('/api/live-intel')
  assert.equal(unrelated.status, 404)
  assert.equal(unrelated.body, 'unrelated route')
  assert.deepEqual(calls, { status: 0, start: [], stop: 0 })
})

test('GET request bodies are rejected without reading status or issuing a token', async (t) => {
  const { calls, send, protectedHeaders } = await fixture(t)
  for (const path of ['/api/endpoint/session', '/api/endpoint/status']) {
    const response = await send(path, 'GET', { ...protectedHeaders, 'content-length': '2' }, '{}')
    assert.equal(response.status, 400)
    assert.doesNotMatch(response.body, /synthetic-device-only/)
  }
  assert.deepEqual(calls, { status: 0, start: [], stop: 0 })
})

test('collector exceptions return a generic error and do not expose raw private exception text', async (t) => {
  const { send, postHeaders } = await fixture(t, {}, true)
  const response = await send('/api/endpoint/start', 'POST', postHeaders, '{"includeSysmon":false}')
  assert.equal(response.status, 503)
  assert.doesNotMatch(response.body, /private-account|private-path|private-exception|at |Error:/)
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.equal(response.headers['access-control-allow-origin'], undefined)
})

test('IPv6 and IPv4-mapped loopback addresses pass only with an exact local Host and token', async (t) => {
  for (const address of ['::1', '::ffff:127.0.0.1']) {
    const { calls, monitor } = monitorFixture()
    const socket = new Socket()
    for (const [key, value] of Object.entries({ remoteAddress: address, localAddress: address, localPort: 5173 })) {
      Object.defineProperty(socket, key, { value, configurable: true })
    }
    const incoming = new IncomingMessage(socket)
    incoming.url = '/api/endpoint/status'
    incoming.method = 'GET'
    incoming.headers = { ...CLIENT, host: address === '::1' ? '[::1]:5173' : '127.0.0.1:5173', 'x-cyber-lab-endpoint-token': TOKEN, 'sec-fetch-site': 'same-origin' }
    const response = new ServerResponse(incoming)
    const end = t.mock.method(response, 'end', () => response)
    await createEndpointMiddleware(monitor, { platform: 'win32', randomToken: () => TOKEN })(incoming, response, () => assert.fail('private request fell through'))
    assert.equal(response.statusCode, 200)
    assert.deepEqual(JSON.parse(String(end.mock.calls[0].arguments[0])), PRIVATE_SNAPSHOT)
    assert.equal(calls.status, 1)
    socket.destroy()
  }
})

test('already disconnected private requests do not collect or write response headers', async (t) => {
  const { calls, monitor } = monitorFixture()
  const incoming = new IncomingMessage(new Socket())
  incoming.url = '/api/endpoint/start'
  incoming.method = 'POST'
  const response = new ServerResponse(incoming)
  response.destroy()
  const headers = t.mock.method(response, 'setHeader')
  const end = t.mock.method(response, 'end')
  await createEndpointMiddleware(monitor, { platform: 'win32', randomToken: () => TOKEN })(incoming, response, () => assert.fail('private request fell through'))
  assert.equal(headers.mock.callCount(), 0)
  assert.equal(end.mock.callCount(), 0)
  assert.deepEqual(calls, { status: 0, start: [], stop: 0 })
})

test('process sessions use independently generated tokens and reject malformed token factories', async (t) => {
  const { monitor } = monitorFixture()
  for (const invalidToken of ['', 'a'.repeat(63), 'a'.repeat(65), 'Z'.repeat(64), 'a'.repeat(63) + '\0']) {
    assert.throws(() => createEndpointMiddleware(monitor, { randomToken: () => invalidToken }), /32 random bytes/)
  }
  const tokens: string[] = []
  for (let index = 0; index < 2; index++) {
    const socket = new Socket()
    for (const [key, value] of Object.entries({ remoteAddress: '127.0.0.1', localAddress: '127.0.0.1', localPort: 5173 })) {
      Object.defineProperty(socket, key, { value, configurable: true })
    }
    const incoming = new IncomingMessage(socket)
    incoming.url = '/api/endpoint/session'
    incoming.method = 'GET'
    incoming.headers = { ...CLIENT, host: '127.0.0.1:5173' }
    const response = new ServerResponse(incoming)
    const end = t.mock.method(response, 'end', () => response)
    await createEndpointMiddleware(monitor, { platform: 'win32' })(incoming, response, () => assert.fail('session fell through'))
    tokens.push(JSON.parse(String(end.mock.calls[0].arguments[0])).token)
    socket.destroy()
  }
  assert.match(tokens[0], /^[a-f0-9]{64}$/)
  assert.match(tokens[1], /^[a-f0-9]{64}$/)
  assert.notEqual(tokens[0], tokens[1])
})

test('the private route grammar rejects query options, including otherwise valid requests', async (t) => {
  const { calls, send, protectedHeaders, postHeaders } = await fixture(t)
  for (const [path, method, headers, body] of [
    ['/api/endpoint/session?refresh=1', 'GET', CLIENT, undefined],
    ['/api/endpoint/status?filename=private', 'GET', protectedHeaders, undefined],
    ['/api/endpoint/start?command=Get-Content', 'POST', postHeaders, '{"includeSysmon":false}'],
    ['/api/endpoint/stop?', 'POST', postHeaders, '{}'],
  ] as const) {
    const response = await send(path, method, headers, body)
    assert.equal(response.status, 400)
    assert.doesNotMatch(response.body, /private|Get-Content|synthetic-device-only/)
  }
  assert.deepEqual(calls, { status: 0, start: [], stop: 0 })
})

test('the JSON request grammar rejects non-JSON Unicode whitespace rather than treating it as a valid action', async (t) => {
  const { calls, send, postHeaders } = await fixture(t)
  for (const whitespace of ['\u00a0', '\u2028', '\ufeff']) {
    for (const [path, body] of [
      ['/api/endpoint/start', `${whitespace}{"includeSysmon":false}`],
      ['/api/endpoint/stop', `{${whitespace}}`],
    ]) {
      const response = await send(path, 'POST', postHeaders, body)
      assert.equal(response.status, 400, `${path}: U+${whitespace.charCodeAt(0).toString(16)}`)
    }
  }
  assert.deepEqual(calls, { status: 0, start: [], stop: 0 })
})

test('chunked request bodies are bounded by actual bytes, not a missing Content-Length', async (t) => {
  const { calls, port, postHeaders } = await fixture(t)
  const status = await new Promise<number>((resolve, reject) => {
    const outgoing = request({ hostname: '127.0.0.1', port, path: '/api/endpoint/start', method: 'POST', headers: { ...postHeaders, 'transfer-encoding': 'chunked' } }, (response) => {
      response.resume()
      response.on('end', () => resolve(response.statusCode ?? 0))
    })
    outgoing.on('error', reject)
    outgoing.write('{"includeSysmon":false,"padding":"')
    outgoing.write('x'.repeat(2_048))
    outgoing.end('"}')
  })
  assert.equal(status, 413)
  assert.deepEqual(calls, { status: 0, start: [], stop: 0 })
})

test('malformed UTF-8 request bytes cannot start collection', async (t) => {
  const { calls, port, postHeaders } = await fixture(t)
  const status = await new Promise<number>((resolve, reject) => {
    const outgoing = request({ hostname: '127.0.0.1', port, path: '/api/endpoint/start', method: 'POST', headers: postHeaders }, (response) => {
      response.resume()
      response.on('end', () => resolve(response.statusCode ?? 0))
    })
    outgoing.on('error', reject)
    outgoing.end(Buffer.from([0xc3, 0x28]))
  })
  assert.equal(status, 400)
  assert.deepEqual(calls, { status: 0, start: [], stop: 0 })
})

test('a disconnected incomplete POST cannot become a delayed monitoring command', async (t) => {
  const { calls, port, postHeaders } = await fixture(t)
  await new Promise<void>((resolve) => {
    const outgoing = request({ hostname: '127.0.0.1', port, path: '/api/endpoint/start', method: 'POST', headers: { ...postHeaders, 'content-length': '100' } })
    outgoing.on('error', () => {})
    outgoing.on('close', resolve)
    outgoing.flushHeaders()
    outgoing.write('{"includeSysmon":false')
    setTimeout(() => outgoing.destroy(), 20)
  })
  await new Promise<void>((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(calls, { status: 0, start: [], stop: 0 })
})

test('body deadline configuration cannot disable or extend the private read limit', () => {
  const { monitor } = monitorFixture()
  for (const bodyTimeoutMs of [0, -1, 5_001, 1.5, NaN, Infinity]) {
    assert.throws(() => createEndpointMiddleware(monitor, { bodyTimeoutMs }), /between 1 and 5000/)
  }
})

test('an incomplete body with drip-fed bytes is terminated by the total deadline without collecting', async (t) => {
  const { calls, port, postHeaders } = await fixture(t, { bodyTimeoutMs: 30 })
  const started = performance.now()
  await new Promise<void>((resolve, reject) => {
    const outgoing = request({ hostname: '127.0.0.1', port, path: '/api/endpoint/start', method: 'POST', headers: { ...postHeaders, 'content-length': '100' } })
    const safety = setTimeout(() => { outgoing.destroy(); reject(new Error('Body deadline did not close its own connection.')) }, 2_000)
    const drip = setInterval(() => { if (!outgoing.destroyed) outgoing.write(' ') }, 5)
    outgoing.on('error', () => {})
    outgoing.on('response', (response) => {
      response.resume()
      if (response.statusCode === 200) reject(new Error('Incomplete request started the collector.'))
    })
    outgoing.on('close', () => { clearInterval(drip); clearTimeout(safety); resolve() })
    outgoing.flushHeaders()
    outgoing.write('{"includeSysmon":false')
  })
  assert.ok(performance.now() - started < 1_000, 'The deadline must not reset on each new byte.')
  assert.deepEqual(calls, { status: 0, start: [], stop: 0 })
})

test('a completed private body clears its deadline without terminating a later valid request', async (t) => {
  const { calls, send, postHeaders, protectedHeaders } = await fixture(t, { bodyTimeoutMs: 30 })
  assert.equal((await send('/api/endpoint/start', 'POST', postHeaders, '{"includeSysmon":false}')).status, 200)
  await new Promise<void>((resolve) => setTimeout(resolve, 50))
  assert.equal((await send('/api/endpoint/status', 'GET', protectedHeaders)).status, 200)
  assert.deepEqual(calls, { status: 1, start: [{ includeSysmon: false }], stop: 0 })
})

test('proxy provenance headers cannot turn rewritten loopback requests into private endpoint access', async (t) => {
  const { calls, send, protectedHeaders, postHeaders } = await fixture(t)
  for (const proxyHeader of [
    'Forwarded', 'Via', 'X-Forwarded-For', 'X-Forwarded-Host', 'X-Forwarded-Proto',
    'X-Forwarded-Port', 'X-Forwarded-Prefix', 'X-Forwarded-Unrecognized',
    'X-Real-IP', 'CF-Connecting-IP', 'True-Client-IP', 'X-Client-IP',
    'Client-IP', 'X-Cluster-Client-IP', 'X-Originating-IP',
  ]) {
    for (const [path, method, headers, body] of [
      ['/api/endpoint/session', 'GET', CLIENT, undefined],
      ['/api/endpoint/status', 'GET', protectedHeaders, undefined],
      ['/api/endpoint/start', 'POST', postHeaders, '{"includeSysmon":false}'],
      ['/api/endpoint/stop', 'POST', postHeaders, '{}'],
    ] as const) {
      // GETs deliberately have no Origin, as same-origin browser reads do.
      // The socket and Host look local even though the provenance is a proxy.
      const response = await send(path, method, { ...headers, 'sec-fetch-site': 'same-origin', [proxyHeader]: 'synthetic-forwarded-value' }, body)
      assert.equal(response.status, 403, `${proxyHeader}: ${method} ${path}`)
      assert.equal(JSON.parse(response.body).code, 'endpoint_local_only')
      assert.doesNotMatch(response.body, /synthetic-device-only|synthetic-forwarded-value/)
      assert.doesNotMatch(response.body, new RegExp(TOKEN))
      assert.equal(response.headers['access-control-allow-origin'], undefined)
      assert.equal(response.headers['cache-control'], 'no-store')
    }
  }
  assert.deepEqual(calls, { status: 0, start: [], stop: 0 })
  assert.equal((await send('/api/endpoint/status', 'GET', protectedHeaders)).status, 200)
})

test('an empty or differently cased proxy header still rejects an otherwise valid local session', async (t) => {
  const { calls, send, port } = await fixture(t)
  for (const proxyHeader of ['fOrWaRdEd', 'vIa', 'x-FoRwArDeD-fOr', 'cF-CoNnEcTiNg-iP']) {
    const response = await send('/api/endpoint/session', 'GET', { ...CLIENT, host: `localhost:${port}`, 'sec-fetch-site': 'same-origin', [proxyHeader]: '' })
    assert.equal(response.status, 403, proxyHeader)
    assert.doesNotMatch(response.body, new RegExp(TOKEN))
  }
  assert.deepEqual(calls, { status: 0, start: [], stop: 0 })
})
