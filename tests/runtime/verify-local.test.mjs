import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { verifyLocal } from '../../scripts/verify-local.mjs'
import { PROJECT_ROOT } from '../../scripts/dev.mjs'
import { previewIdentity } from '../../backend/preview-identity.ts'
import { CISA_NAME, NEWS_NAME, MSRC_NAME } from '../../shared-types/live-intel.ts'

const exec = promisify(execFile)
const script = fileURLToPath(new URL('../../scripts/verify-local.mjs', import.meta.url))
const preview = 'http://127.0.0.1:5173/'
const goLive = 'http://127.0.0.1:5500/'
const previewHtml = '<title>Cyber Intelligence Lab</title><script src="/@vite/client"></script>'

function payload() {
  return {
    generatedAt: '2026-10-05T12:00:00Z', pollAfterMs: 60_000, cacheTtlMs: 60_000,
    sources: [CISA_NAME, NEWS_NAME, MSRC_NAME].map((name) => ({ name, status: 'ok', count: 0 })),
    kev: [], news: [], advisories: [],
  }
}

function response(body, contentType, headers = {}, status = 200) {
  return new Response(body, { status, headers: { 'Content-Type': contentType, ...headers } })
}

function previewHeaders() {
  return { 'Access-Control-Allow-Origin': goLive.slice(0, -1), 'x-cyber-lab-preview': previewIdentity(PROJECT_ROOT) }
}

function routes(data = payload()) {
  return new Map([
    [preview, () => response(previewHtml, 'text/html; charset=utf-8', previewHeaders())],
    [`${preview}app/main.tsx`, () => response('import { createRoot } from "react-dom/client"; createRoot(root).render(jsx(App, {}));', 'text/javascript')],
    [`${preview}fonts/Manrope-Variable.woff2`, () => response(new Uint8Array(101), 'font/woff2')],
    [`${preview}api/live-intel`, () => response(JSON.stringify(data), 'application/json')],
    [goLive, () => response('<p id="launch-status">Checking preview...</p><script src="/launch.js"></script>', 'text/html')],
    [`${goLive}launch.css`, () => response('body { color: white; }', 'text/css')],
    [`${goLive}launch.js`, () => response(`const preview = '${preview}'; location.replace(preview);`, 'application/javascript')],
  ])
}

function verification({ data, overrides = [] } = {}) {
  const fixtures = routes(data)
  for (const [url, handler] of overrides) fixtures.set(url, handler)
  const calls = []
  const logs = []
  const options = {
    async fetcher(url, request) {
      calls.push({ url, request })
      assert.ok(fixtures.has(url), `Unexpected verification request: ${url}`)
      return fixtures.get(url)()
    },
    log(message) { logs.push(message) },
  }
  return { calls, logs, options }
}

test('local verification checks the preview, transformed React entry, self-hosted font and public API', async () => {
  const context = verification()
  await verifyLocal(context.options)
  assert.deepEqual(context.calls.map(({ url }) => url), [preview, `${preview}app/main.tsx`, `${preview}fonts/Manrope-Variable.woff2`, `${preview}api/live-intel`])
  for (const { request } of context.calls) {
    assert.equal(request.cache, 'no-store')
    assert.equal(request.redirect, 'error')
    assert.ok(request.signal instanceof AbortSignal)
  }
  assert.deepEqual(context.calls[0].request.headers, { Origin: goLive.slice(0, -1) })
  assert.equal(context.logs.length, 2)
  assert.match(context.logs[0], /^PASS http:\/\/127\.0\.0\.1:5173\//)
  assert.match(context.logs[1], /Source health \(not a startup gate\)/)
})

test('Go Live verification additionally checks the independent entry page and both handoff assets', async () => {
  const context = verification()
  await verifyLocal({ ...context.options, includeGoLive: true })
  assert.deepEqual(context.calls.slice(-3).map(({ url }) => url), [goLive, `${goLive}launch.css`, `${goLive}launch.js`])
  assert.equal(context.logs.length, 3)
  assert.match(context.logs[2], /^PASS http:\/\/127\.0\.0\.1:5500\//)
})

test('provider outages are reported honestly but do not fail a valid local startup contract', async () => {
  const data = payload()
  data.sources[0].status = 'error'
  data.sources[1].status = 'stale'
  const context = verification({ data })
  await verifyLocal(context.options)
  assert.ok(context.logs[1].includes(`${CISA_NAME}: error`))
  assert.ok(context.logs[1].includes(`${NEWS_NAME}: stale`))
})

test('HTTP failures stop verification immediately at the failing resource', async () => {
  const urls = [preview, `${preview}app/main.tsx`, `${preview}fonts/Manrope-Variable.woff2`, `${preview}api/live-intel`, goLive, `${goLive}launch.css`, `${goLive}launch.js`]
  for (const [index, url] of urls.entries()) {
    const context = verification({ overrides: [[url, () => response('unavailable', 'text/plain', {}, 503)]] })
    await assert.rejects(verifyLocal({ ...context.options, includeGoLive: true }), /HTTP 503/)
    assert.equal(context.calls.at(-1).url, url)
    assert.equal(context.calls.length, index + 1)
    assert.equal(context.logs.some((message) => message.startsWith(`PASS ${goLive}`)), false)
  }
})

test('wrong content types are rejected for every preview and Go Live asset', async () => {
  const urls = [preview, `${preview}app/main.tsx`, `${preview}fonts/Manrope-Variable.woff2`, `${preview}api/live-intel`, goLive, `${goLive}launch.css`, `${goLive}launch.js`]
  for (const url of urls) {
    const context = verification({ overrides: [[url, () => response('wrong asset', 'application/octet-stream')]] })
    await assert.rejects(verifyLocal({ ...context.options, includeGoLive: true }), /wrong content type/)
    assert.equal(context.calls.at(-1).url, url)
  }
})

test('wrong-project preview pages and missing Go Live CORS are rejected before checking app assets', async () => {
  for (const html of ['<title>Other project</title><script src="/@vite/client"></script>', '<title>Cyber Intelligence Lab</title>']) {
    const context = verification({ overrides: [[preview, () => response(html, 'text/html', previewHeaders())]] })
    await assert.rejects(verifyLocal(context.options), /not this project/)
    assert.equal(context.calls.length, 1)
    assert.deepEqual(context.logs, [])
  }
  for (const origin of [undefined, '*', 'http://localhost:5500']) {
    const context = verification({ overrides: [[preview, () => response(previewHtml, 'text/html', {
      'x-cyber-lab-preview': previewIdentity(PROJECT_ROOT), ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    })]] })
    await assert.rejects(verifyLocal(context.options), /loopback CORS access/)
    assert.equal(context.calls.length, 1)
  }
})

test('verification rejects another checkout or old preview even when its title, Vite marker and CORS match', async () => {
  for (const identity of [undefined, previewIdentity('a-different-checkout')]) {
    const context = verification({ overrides: [[preview, () => response(previewHtml, 'text/html', {
      'Access-Control-Allow-Origin': goLive.slice(0, -1), ...(identity ? { 'x-cyber-lab-preview': identity } : {}),
    })]] })
    await assert.rejects(verifyLocal(context.options), /different checkout or an old preview/)
    assert.equal(context.calls.length, 1)
    assert.deepEqual(context.logs, [])
  }
})

test('untransformed React, undersized fonts and invalid API payloads cannot produce a pass', async () => {
  const failures = [
    [`${preview}app/main.tsx`, () => response('createRoot(root).render(<App />)', 'text/javascript'), /React entry was not transformed/],
    [`${preview}app/main.tsx`, () => response('export const unrelated = true', 'text/javascript'), /React entry was not transformed/],
    [`${preview}fonts/Manrope-Variable.woff2`, () => response(new Uint8Array(100), 'font/woff2'), /local font is empty/],
    [`${preview}api/live-intel`, () => response('{}', 'application/json'), /invalid payload/],
    [`${preview}api/live-intel`, () => response('not json', 'application/json'), /Unexpected token/],
  ]
  for (const [url, handler, expected] of failures) {
    const context = verification({ overrides: [[url, handler]] })
    await assert.rejects(verifyLocal(context.options), expected)
    assert.equal(context.calls.at(-1).url, url)
    assert.deepEqual(context.logs, [])
  }
})

test('Go Live rejects stale settings and scripts with a wrong target or missing handoff', async () => {
  for (const html of ['<title>Cyber Intelligence Lab</title>', '<p id="launch-status">Checking...</p>', '<script src="/launch.js"></script>']) {
    const context = verification({ overrides: [[goLive, () => response(html, 'text/html')]] })
    await assert.rejects(verifyLocal({ ...context.options, includeGoLive: true }), /Go Live still has the old settings/)
    assert.equal(context.calls.at(-1).url, goLive)
  }
  for (const source of [`location.replace('http://127.0.0.1:5174/');`, `const preview = '${preview}';`]) {
    const context = verification({ overrides: [[`${goLive}launch.js`, () => response(source, 'text/javascript')]] })
    await assert.rejects(verifyLocal({ ...context.options, includeGoLive: true }), /handoff script is missing or points at the wrong port/)
    assert.equal(context.logs.length, 2)
  }
})

test('redirect and network failures propagate without false-positive verification output', async () => {
  for (const failure of [new TypeError('redirect forbidden'), new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }), new DOMException('request expired', 'TimeoutError')]) {
    const logs = []
    await assert.rejects(verifyLocal({ fetcher: async () => { throw failure }, log: (message) => logs.push(message) }), (error) => {
      assert.equal(error.cause, failure)
      assert.match(error.message, /5173.*could not connect.*start\.bat/)
      return true
    })
    assert.deepEqual(logs, [])
  }
})

test('an unavailable Go Live extension receives its own start and restart guidance', async () => {
  const failure = new TypeError('fetch failed')
  const context = verification({ overrides: [[goLive, () => { throw failure }]] })
  await assert.rejects(verifyLocal({ ...context.options, includeGoLive: true }), (error) => {
    assert.equal(error.cause, failure)
    assert.match(error.message, /5500.*VS Code Live Server extension.*Restart it after settings changes/)
    return true
  })
  assert.equal(context.logs.length, 2)
  assert.equal(context.calls.at(-1).url, goLive)
})

test('verify-local CLI rejects unsupported arguments before attempting any localhost requests', async () => {
  for (const args of [['--unknown'], ['--go-live', '--port', '5501']]) {
    await assert.rejects(exec(process.execPath, [script, ...args]), (error) => {
      assert.equal(error.code, 1)
      assert.match(error.stderr, /Usage: npm run verify:local/)
      assert.match(error.stderr, /Start the app with start\.bat or npm run dev/)
      assert.equal(error.stdout, '')
      return true
    })
  }
})
