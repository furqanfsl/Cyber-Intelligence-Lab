import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { request, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { createAppServer, installShutdownHandlers, readListenOptions } from '../../runtime/server.ts'

async function fixture(t: TestContext, handler?: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'cyber-lab-runtime-'))
  const distDir = join(directory, 'dist')
  await mkdir(join(distDir, 'assets'), { recursive: true })
  await writeFile(join(distDir, 'index.html'), '<!doctype html><title>Cyber lab</title>')
  await writeFile(join(distDir, 'assets', 'app.js'), 'console.log("lab")')
  await writeFile(join(distDir, 'assets', 'app.css'), 'body { color: white; }')
  await writeFile(join(distDir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  await writeFile(join(distDir, 'space name.txt'), 'encoded filename')
  await writeFile(join(directory, 'private.txt'), 'must never be served')
  let calls = 0
  const server = createAppServer({
    distDir,
    liveIntelMiddleware: handler ?? ((_request, response) => {
      calls += 1
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.end(JSON.stringify({ sources: [], calls }))
    }),
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
        server.closeAllConnections()
      })
    }
    await rm(directory, { recursive: true, force: true })
  })
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const port = address.port
  function get(path: string, method = 'GET', headers: Record<string, string> = {}, body?: string) {
    return new Promise<{ status: number; body: string; bytes: Buffer; headers: import('node:http').IncomingHttpHeaders }>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path, method, headers }, (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => { chunks.push(chunk) })
        response.on('end', () => {
          const bytes = Buffer.concat(chunks)
          resolve({ status: response.statusCode ?? 0, body: bytes.toString('utf8'), bytes, headers: response.headers })
        })
      })
      req.on('error', reject)
      req.end(body)
    })
  }
  return { get, directory, distDir, server, calls: () => calls }
}

test('serves the built homepage with safe headers and no absolute paths', async (t) => {
  const { get } = await fixture(t)
  const response = await get('/')
  assert.equal(response.status, 200)
  assert.match(response.body, /Cyber lab/)
  assert.equal(response.headers['content-type'], 'text/html; charset=utf-8')
  assert.equal(response.headers['x-content-type-options'], 'nosniff')
  assert.equal(response.headers['x-frame-options'], 'DENY')
  assert.equal(response.headers['referrer-policy'], 'no-referrer')
  assert.equal(response.headers['cache-control'], 'no-cache')
})

test('production CSP restricts active content while supporting local fonts and React style attributes', async (t) => {
  const { get } = await fixture(t)
  const response = await get('/')
  const policy = String(response.headers['content-security-policy'])
  const directives = new Map(policy.split('; ').map((directive) => {
    const [name, ...values] = directive.split(' ')
    return [name, values.join(' ')]
  }))
  for (const directive of ['default-src', 'script-src', 'font-src', 'img-src', 'connect-src', 'style-src-elem']) {
    assert.equal(directives.get(directive), "'self'", directive)
  }
  for (const directive of ['script-src-attr', 'object-src', 'base-uri', 'frame-src', 'frame-ancestors', 'form-action']) {
    assert.equal(directives.get(directive), "'none'", directive)
  }
  assert.equal(directives.get('style-src-attr'), "'unsafe-inline'")
  assert.equal(directives.get('style-src'), "'self' 'unsafe-inline'")
  assert.doesNotMatch(policy, /unsafe-eval|https:|\*/)
  assert.equal(response.headers['permissions-policy'], 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), clipboard-write=(self)')
  for (const path of ['/api/live-intel', '/healthz', '/missing.js']) {
    const other = await get(path)
    assert.equal(other.headers['content-security-policy'], policy, path)
    assert.equal(other.headers['permissions-policy'], response.headers['permissions-policy'], path)
  }
  const notModified = await get('/', 'GET', { 'if-none-match': response.headers.etag! })
  assert.equal(notModified.status, 304)
  assert.equal(notModified.headers['content-security-policy'], policy)
})

test('serves JavaScript, CSS, SVG and percent-encoded filenames with their MIME types', async (t) => {
  const { get } = await fixture(t)
  for (const [path, mime] of [
    ['/assets/app.js?v=1', 'text/javascript; charset=utf-8'],
    ['/assets/app.css', 'text/css; charset=utf-8'],
    ['/favicon.svg', 'image/svg+xml'],
    ['/space%20name.txt', 'text/plain; charset=utf-8'],
  ]) {
    const response = await get(path)
    assert.equal(response.status, 200, path)
    assert.equal(response.headers['content-type'], mime, path)
  }
})

test('optional build assets retain correct MIME types under nosniff', async (t) => {
  const { get, distDir } = await fixture(t)
  for (const [name, mime] of [
    ['module.mjs', 'text/javascript; charset=utf-8'], ['engine.wasm', 'application/wasm'],
    ['font.ttf', 'font/ttf'], ['font.otf', 'font/otf'], ['poster.AVIF', 'image/avif'],
    ['animation.gif', 'image/gif'], ['app.webmanifest', 'application/manifest+json'],
    ['opaque.bin', 'application/octet-stream'],
  ]) {
    await writeFile(join(distDir, 'assets', name), 'asset fixture')
    const response = await get(`/assets/${name}`)
    assert.equal(response.status, 200, name)
    assert.equal(response.headers['content-type'], mime, name)
    assert.equal(response.headers['x-content-type-options'], 'nosniff', name)
  }
})

test('HEAD returns file metadata without a response body', async (t) => {
  const { get } = await fixture(t)
  const response = await get('/assets/app.js', 'HEAD')
  assert.equal(response.status, 200)
  assert.equal(response.body, '')
  assert.equal(Number(response.headers['content-length']), Buffer.byteLength('console.log("lab")'))
})

test('Unicode asset names preserve binary bytes and byte-based content lengths', async (t) => {
  const { get, distDir } = await fixture(t)
  const filename = 'évidence-☃.png'
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 255, 128, 195, 169])
  await writeFile(join(distDir, filename), bytes)
  const response = await get(`/${encodeURIComponent(filename)}`)
  assert.equal(response.status, 200)
  assert.deepEqual(response.bytes, bytes)
  assert.equal(response.headers['content-length'], String(bytes.length))
  assert.equal(response.headers['content-type'], 'image/png')
  const head = await get(`/${encodeURIComponent(filename)}`, 'HEAD')
  assert.equal(head.bytes.length, 0)
  assert.equal(head.headers['content-length'], response.headers['content-length'])
})

test('static GET and HEAD revalidate matching weak, strong, list and wildcard entity tags', async (t) => {
  const { get } = await fixture(t)
  const first = await get('/assets/app.js')
  const etag = first.headers.etag
  assert.ok(etag)
  assert.ok(etag.startsWith('W/"'))
  for (const method of ['GET', 'HEAD']) {
    for (const condition of [etag, etag.slice(2), `"other", ${etag}`, '*']) {
      const response = await get('/assets/app.js', method, { 'if-none-match': condition })
      assert.equal(response.status, 304)
      assert.equal(response.body, '')
      assert.equal(response.headers.etag, etag)
      assert.equal(response.headers['cache-control'], 'no-cache')
      assert.equal(response.headers['content-length'], undefined)
    }
  }
})

test('static validators do not turn changed, missing, or dynamic resources into 304 responses', async (t) => {
  const { get, distDir } = await fixture(t)
  const first = await get('/assets/app.js')
  const etag = first.headers.etag!
  assert.equal((await get('/assets/app.js', 'GET', { 'if-none-match': '"unrelated"' })).status, 200)
  await writeFile(join(distDir, 'assets', 'app.js'), 'console.log("new")')
  const changedAt = new Date('2027-01-01T00:00:00Z')
  await utimes(join(distDir, 'assets', 'app.js'), changedAt, changedAt)
  const changed = await get('/assets/app.js', 'GET', { 'if-none-match': etag })
  assert.equal(changed.status, 200)
  assert.notEqual(changed.headers.etag, etag)
  assert.equal(changed.body, 'console.log("new")')
  assert.equal((await get('/missing.js', 'GET', { 'if-none-match': '*' })).status, 404)
  const api = await get('/api/live-intel', 'GET', { 'if-none-match': '*' })
  assert.equal(api.status, 200)
  assert.equal(api.headers.etag, undefined)
})

test('only content-hashed assets use immutable long-lived caching', async (t) => {
  const { get, distDir } = await fixture(t)
  for (const name of ['index-BBPq_AAX.js', 'index-DSUPjFDl.css', 'font-AB12cd_3.woff2', 'report-AB12cd_3.html', 'index-short.js']) {
    await writeFile(join(distDir, 'assets', name), 'fixture')
  }
  await writeFile(join(distDir, 'index-BBPq_AAX.js'), 'outside assets')
  for (const path of ['/assets/index-BBPq_AAX.js?version=1', '/assets/index-DSUPjFDl.css', '/assets/font-AB12cd_3.woff2']) {
    const response = await get(path)
    assert.equal(response.headers['cache-control'], 'public, max-age=31536000, immutable', path)
    const revalidated = await get(path, 'HEAD', { 'if-none-match': response.headers.etag! })
    assert.equal(revalidated.status, 304)
    assert.equal(revalidated.headers['cache-control'], response.headers['cache-control'])
  }
  for (const path of ['/', '/index.html', '/assets/app.js', '/assets/index-short.js', '/assets/report-AB12cd_3.html', '/index-BBPq_AAX.js', '/favicon.svg']) {
    const response = await get(path)
    assert.equal(response.headers['cache-control'], 'no-cache', path)
  }
  const fallback = await get('/incident/overview', 'GET', { accept: 'text/html' })
  assert.equal(fallback.headers['cache-control'], 'no-cache')
  const missing = await get('/assets/missing-AB12cd_3.js')
  assert.equal(missing.headers['cache-control'], 'no-store')
})

test('only HTML navigation requests get an extensionless SPA fallback', async (t) => {
  const { get } = await fixture(t)
  assert.equal((await get('/incident/overview', 'GET', { accept: 'text/html' })).status, 200)
  for (const path of ['/incident/overview', '/assets/missing.js', '/assets/missing', '/missing.svg']) {
    const headers: Record<string, string> = path === '/incident/overview' ? {} : { accept: 'text/html' }
    const response = await get(path, 'GET', headers)
    assert.equal(response.status, 404, path)
    assert.doesNotMatch(response.body, /Cyber lab/, path)
  }
})

test('existing directories never become listings or implicit index documents', async (t) => {
  const { get, distDir } = await fixture(t)
  await mkdir(join(distDir, 'reports'))
  await writeFile(join(distDir, 'reports', 'index.html'), '<title>Nested index fixture</title>')
  for (const path of ['/assets', '/assets/', '/reports', '/reports/']) {
    const response = await get(path, 'GET', { accept: 'text/html' })
    assert.equal(response.status, 404, path)
    assert.doesNotMatch(response.body, /Nested index|app\.js|Cyber lab/)
    assert.equal(response.headers['cache-control'], 'no-store')
  }
  assert.equal((await get('/reports/index.html')).status, 200)
})

test('SPA fallback honors HTML media types and explicit quality refusals', async (t) => {
  const { get } = await fixture(t)
  for (const accept of ['text/html;q=0', 'text/html;q=0.000, */*;q=1', 'application/nottext/html', 'text/html;q=bogus', 'text/html;q=1.5']) {
    assert.equal((await get('/incident/details', 'GET', { accept })).status, 404, accept)
  }
  for (const accept of ['TEXT/HTML', 'application/json, text/html; q=0.5', 'text/html; charset=utf-8']) {
    assert.equal((await get('/incident/details', 'GET', { accept })).status, 200, accept)
  }
})

test('rejects unsupported file methods without changing files', async (t) => {
  const { get } = await fixture(t)
  const response = await get('/index.html', 'POST')
  assert.equal(response.status, 405)
  assert.equal(response.headers.allow, 'GET, HEAD')
  assert.equal((await get('/')).status, 200)
})

test('shares the injected API handler only for the exact supported route', async (t) => {
  const fixtureData = await fixture(t)
  const response = await fixtureData.get('/api/live-intel?check=1')
  assert.equal(response.status, 200)
  assert.deepEqual(JSON.parse(response.body), { sources: [], calls: 1 })
  const head = await fixtureData.get('/api/live-intel', 'HEAD')
  assert.equal(head.status, 200)
  assert.equal(head.body, '')
  for (const path of ['/api', '/api/unknown', '/api/live-intel/extra', '/api/live-intel/']) {
    const unknown = await fixtureData.get(path, 'GET', { accept: 'text/html' })
    assert.equal(unknown.status, 404, path)
    assert.match(unknown.headers['content-type'] ?? '', /application\/json/)
  }
  assert.equal(fixtureData.calls(), 2)
})

test('unsupported API methods return JSON and do not invoke the source handler', async (t) => {
  const { get, calls } = await fixture(t)
  const response = await get('/api/live-intel', 'POST')
  assert.equal(response.status, 405)
  assert.equal(response.headers.allow, 'GET, HEAD')
  assert.equal(JSON.parse(response.body).error, 'Method not allowed')
  assert.equal(calls(), 0)
})

test('read-only endpoints reject request bodies without invoking source work', async (t) => {
  const { get, calls } = await fixture(t)
  for (const path of ['/', '/healthz', '/api/live-intel']) {
    const response = await get(path, 'GET', { 'content-length': '1' }, 'x')
    assert.equal(response.status, 400, path)
    assert.equal(response.headers.connection, 'close')
  }
  const chunked = await get('/api/live-intel', 'GET', { 'transfer-encoding': 'chunked' }, 'x')
  assert.equal(chunked.status, 400)
  assert.equal(calls(), 0)
  assert.equal((await get('/healthz', 'GET', { 'content-length': '0' })).status, 200)
})

test('readiness probes return minimal uncached JSON without fetching intelligence', async (t) => {
  const { get, calls } = await fixture(t)
  const response = await get('/healthz?probe=1', 'GET', { 'if-none-match': '*' })
  assert.equal(response.status, 200)
  assert.deepEqual(JSON.parse(response.body), { status: 'ok' })
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(response.headers.etag, undefined)
  const head = await get('/healthz', 'HEAD')
  assert.equal(head.status, 200)
  assert.equal(head.body, '')
  assert.equal(head.headers['content-length'], response.headers['content-length'])
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const rejected = await get('/healthz', method)
    assert.equal(rejected.status, 405)
    assert.equal(rejected.headers.allow, 'GET, HEAD')
  }
  for (const path of ['/healthz/', '/healthz/child', '/health%7a']) {
    assert.equal((await get(path, 'GET', { accept: 'text/html' })).status, 404)
  }
  assert.equal(calls(), 0)
})

test('readiness remains healthy when an intelligence handler is unavailable', async (t) => {
  const { get } = await fixture(t, () => { throw new Error('upstream unavailable') })
  assert.equal((await get('/api/live-intel')).status, 500)
  assert.deepEqual(JSON.parse((await get('/healthz')).body), { status: 'ok' })
})

test('unexpected handler failures return a generic error rather than exposing server details', async (t) => {
  const { get } = await fixture(t, () => { throw new Error('private path and secret details') })
  const response = await get('/api/live-intel')
  assert.equal(response.status, 500)
  assert.deepEqual(JSON.parse(response.body), { error: 'Unable to serve request' })
  assert.doesNotMatch(response.body, /private|secret|Error|stack/)
})

test('rejects raw and encoded traversal, backslashes, NULs and dotfiles', async (t) => {
  const { get } = await fixture(t)
  for (const path of ['/../private.txt', '/%2e%2e/private.txt', '/assets/%2e%2e/%2e%2e/private.txt', '/..%5cprivate.txt', '/%00', '/.env', '/.git/config']) {
    const response = await get(path)
    assert.ok([400, 403, 404].includes(response.status), `${path}: ${response.status}`)
    assert.doesNotMatch(response.body, /must never be served/)
  }
})

test('malformed URL encoding returns a controlled client error', async (t) => {
  const { get } = await fixture(t)
  const response = await get('/%E0%A4%A')
  assert.equal(response.status, 400)
  assert.doesNotMatch(response.body, /URIError|stack|dist/)
})

test('encoded path separators cannot create alternate API or asset routes', async (t) => {
  const { get, calls } = await fixture(t)
  for (const path of ['/api%2flive-intel', '/api%2Flive-intel', '/assets%2fapp.js', '/assets%5capp.js']) {
    assert.equal((await get(path)).status, 400, path)
  }
  assert.equal(calls(), 0)
  assert.equal((await get('/assets/app.js?ignored=%2f')).status, 200)
})

test('Windows device names are forbidden consistently before filesystem access', async (t) => {
  const { get } = await fixture(t)
  for (const path of ['/NUL', '/con.txt', '/assets/COM1.js', '/lPt9.log', '/PRN/item']) {
    assert.equal((await get(path, 'GET', { accept: 'text/html' })).status, 403, path)
  }
  assert.equal((await get('/console', 'GET', { accept: 'text/html' })).status, 200)
})

test('a directory symlink cannot escape the build directory', async (t) => {
  const { get, directory, distDir } = await fixture(t)
  await symlink(directory, join(distDir, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
  const response = await get('/escape/private.txt')
  assert.equal(response.status, 403)
  assert.doesNotMatch(response.body, /must never be served/)
})

test('fails before listening when the build is absent or has no index', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'cyber-lab-missing-dist-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  assert.throws(() => createAppServer({ distDir: join(directory, 'missing') }), /npm run build/)
  assert.throws(() => createAppServer({ distDir: directory }), /npm run build/)
})

test('listener configuration is local by default and validates port and bind addresses', () => {
  assert.deepEqual(readListenOptions({}), { host: '127.0.0.1', port: 3000 })
  assert.deepEqual(readListenOptions({ HOST: '0.0.0.0', PORT: '8080' }), { host: '0.0.0.0', port: 8080 })
  assert.deepEqual(readListenOptions({ HOST: '::1', PORT: '3001' }), { host: '::1', port: 3001 })
  for (const port of ['', '0', '-1', '65536', '3.5', '3000oops']) {
    assert.throws(() => readListenOptions({ PORT: port }), /PORT/)
  }
  for (const host of ['', 'https://example.com', '0.0.0.0:3000', 'attacker.example']) {
    assert.throws(() => readListenOptions({ HOST: host }), /HOST/)
  }
})

test('graceful shutdown stops listening and removes its signal handlers', async (t) => {
  const { server } = await fixture(t)
  const before = new Set(process.listeners('SIGTERM'))
  const intCount = process.listenerCount('SIGINT')
  installShutdownHandlers(server)
  const shutdown = process.listeners('SIGTERM').find((listener) => !before.has(listener))
  assert.ok(shutdown)
  const closed = once(server, 'close')
  shutdown('SIGTERM')
  await closed
  assert.equal(server.listening, false)
  assert.equal(process.listenerCount('SIGTERM'), before.size)
  assert.equal(process.listenerCount('SIGINT'), intCount)
})
