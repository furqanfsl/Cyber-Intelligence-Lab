import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  acquireStartupLock, dependencyState, ensureDependencies, inspectPreview,
  launchPreview, openBrowser, parseArguments, PREVIEW_URL, PROJECT_ROOT, runCommand,
} from '../../scripts/dev.mjs'
import { previewIdentity } from '../../backend/preview-identity.ts'

const exec = promisify(execFile)
const script = fileURLToPath(new URL('../../scripts/dev.mjs', import.meta.url))
const stampPath = (root) => join(root, 'node_modules/.cache/cyber-lab-preview-dependencies.json')
const viteEntry = (root) => join(root, 'node_modules/vite/dist/node/index.js')
const manifest = () => ({
  name: 'preview-test', scripts: { dev: 'node scripts/dev.mjs' },
  dependencies: { react: '^19.0.0' }, devDependencies: { vite: '^8.0.0' },
  optionalDependencies: { optional: '1.0.0' }, overrides: { transitive: '1.0.0' },
  engines: { node: '>=24.0.0' }, packageManager: 'npm@11.0.0',
})

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'cyber-launcher-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'package.json'), JSON.stringify(manifest()))
  await writeFile(join(root, 'package-lock.json'), '{"lockfileVersion":3}\n')
  return root
}

async function installVite(root) {
  await mkdir(dirname(viteEntry(root)), { recursive: true })
  await writeFile(viteEntry(root), 'export const createServer = () => {}\n')
}

function previewResponse(chunks, { ok = true, readError, cancelError, headers = previewHeaders() } = {}) {
  let offset = 0
  const observed = { reads: 0, cancels: 0 }
  const reader = {
    async read() {
      observed.reads++
      if (readError) throw readError
      return offset < chunks.length ? { done: false, value: chunks[offset++] } : { done: true }
    },
    async cancel() {
      observed.cancels++
      if (cancelError) throw cancelError
    },
  }
  return {
    observed,
    response: { ok, headers: new Headers(headers), body: { getReader: () => reader, cancel: () => reader.cancel() } },
  }
}

const previewHtml = '<title>Cyber Intelligence Lab</title><script src="/@vite/client"></script>'
const encode = (value) => new TextEncoder().encode(value)
function previewHeaders(root = PROJECT_ROOT) {
  return { 'Content-Type': 'text/html; charset=utf-8', 'x-cyber-lab-preview': previewIdentity(root) }
}

function launcher(overrides = {}) {
  const calls = []
  const logs = []
  const server = {
    async listen() { calls.push('listen') },
    async close() { calls.push('close') },
    printUrls() { calls.push('urls') },
  }
  const options = {
    root: 'isolated-test-workspace',
    async lock(root) {
      assert.equal(root, options.root)
      calls.push('lock')
      return async () => { calls.push('release') }
    },
    async inspect(url, identity) {
      assert.equal(url, PREVIEW_URL)
      assert.deepEqual(identity, { root: options.root })
      calls.push('inspect')
      return 'stopped'
    },
    async dependencies(root) { assert.equal(root, options.root); calls.push('dependencies') },
    async state(root) {
      assert.equal(root, options.root)
      calls.push('state')
      return { known: true, installNeeded: false }
    },
    async loadVite() {
      calls.push('load-vite')
      return {
        async createServer(config) {
          calls.push('create-server')
          assert.equal(config.root, options.root)
          assert.equal(config.clearScreen, false)
          assert.deepEqual(config.server, { host: '127.0.0.1', port: 5173, strictPort: true, open: false })
          return server
        },
      }
    },
    async browse() { calls.push('browse') },
    log(message) { logs.push(message) },
    ...overrides,
  }
  return { calls, logs, server, options }
}

test('dev arguments accept only documented switches, with independent open/help flags', () => {
  assert.deepEqual(parseArguments([]), { open: false, help: false })
  assert.deepEqual(parseArguments(['--open']), { open: true, help: false })
  assert.deepEqual(parseArguments(['--help']), { open: false, help: true })
  assert.deepEqual(parseArguments(['--help', '--open']), { open: true, help: true })
  for (const args of [['--port', '5174'], ['--host'], ['--open', 'https://example.com'], ['--help', '--unknown']]) {
    assert.throws(() => parseArguments(args), /Unknown option/)
  }
})

test('dev help exits without starting a server, and invalid options fail before startup', async () => {
  const help = await exec(process.execPath, [script, '--help'])
  assert.match(help.stdout, /Usage: npm run dev/)
  assert.ok(help.stdout.includes(PREVIEW_URL))
  assert.equal(help.stderr, '')
  await assert.rejects(exec(process.execPath, [script, '--invalid']), (error) => {
    assert.equal(error.code, 1)
    assert.match(error.stderr, /Unknown option/)
    assert.match(error.stderr, /Could not start Cyber Intelligence Lab/)
    return true
  })
})

test('dependency state requires both the Vite entry and a matching successful-install stamp', async (t) => {
  const root = await workspace(t)
  const missing = await dependencyState(root)
  assert.match(missing.fingerprint, /^[a-f0-9]{64}$/)
  assert.equal(missing.installNeeded, true)
  assert.equal(missing.known, false)
  await installVite(root)
  assert.equal((await dependencyState(root)).installNeeded, true)
  await ensureDependencies(root, { install: installVite, log: () => {} })
  assert.deepEqual(await dependencyState(root), { fingerprint: missing.fingerprint, installNeeded: false, known: true })
  await rm(viteEntry(root))
  assert.equal((await dependencyState(root)).installNeeded, true)
  assert.equal((await dependencyState(root)).known, true)
})

test('fingerprints include all installation inputs but ignore unrelated script and description edits', async (t) => {
  const root = await workspace(t)
  const before = (await dependencyState(root)).fingerprint
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'overrides', 'engines', 'packageManager']) {
    const changed = manifest()
    changed[key] = key === 'packageManager' ? 'npm@11.1.0' : { changed: '2.0.0' }
    await writeFile(join(root, 'package.json'), JSON.stringify(changed))
    assert.notEqual((await dependencyState(root)).fingerprint, before, key)
  }
  await writeFile(join(root, 'package.json'), JSON.stringify({ ...manifest(), description: 'new copy', scripts: { test: 'node --test' } }))
  assert.equal((await dependencyState(root)).fingerprint, before)
  await writeFile(join(root, 'package-lock.json'), '{"lockfileVersion":3,"changed":true}\n')
  assert.notEqual((await dependencyState(root)).fingerprint, before)
})

test('a successful dependency install saves its fingerprint and subsequent launches skip npm', async (t) => {
  const root = await workspace(t)
  const logs = []
  let installs = 0
  const install = async (directory) => { assert.equal(directory, root); installs++; await installVite(directory) }
  assert.equal(await ensureDependencies(root, { install, log: (message) => logs.push(message) }), true)
  assert.equal(installs, 1)
  assert.equal(logs.length, 1)
  assert.match(logs[0], /npm ci/)
  assert.equal(JSON.parse(await readFile(stampPath(root), 'utf8')).fingerprint, (await dependencyState(root)).fingerprint)
  assert.equal(await ensureDependencies(root, { install, log: (message) => logs.push(message) }), false)
  assert.equal(installs, 1)
  assert.equal(logs.length, 1)
})

test('malformed install stamps are treated as unknown and repaired by a successful install', async (t) => {
  const root = await workspace(t)
  await mkdir(dirname(stampPath(root)), { recursive: true })
  await writeFile(stampPath(root), '{interrupted')
  await installVite(root)
  assert.equal((await dependencyState(root)).known, false)
  assert.equal(await ensureDependencies(root, { install: installVite, log: () => {} }), true)
  assert.equal((await dependencyState(root)).installNeeded, false)
})

test('failed npm installs never mark dependencies current or write a success stamp', async (t) => {
  const root = await workspace(t)
  const failure = new Error('simulated npm ci failure')
  await assert.rejects(ensureDependencies(root, { install: async () => { throw failure }, log: () => {} }), (error) => error === failure)
  await assert.rejects(readFile(stampPath(root)), { code: 'ENOENT' })
  assert.equal((await dependencyState(root)).installNeeded, true)
})

test('install completion without a Vite entry is rejected without a success stamp', async (t) => {
  const root = await workspace(t)
  await assert.rejects(ensureDependencies(root, { install: async () => {}, log: () => {} }), /did not provide Vite/)
  await assert.rejects(readFile(stampPath(root)), { code: 'ENOENT' })
})

test('inputs changing during installation are rejected without stamping the new dependencies', async (t) => {
  const root = await workspace(t)
  await assert.rejects(ensureDependencies(root, {
    install: async () => {
      await installVite(root)
      await writeFile(join(root, 'package-lock.json'), '{"lockfileVersion":3,"changed":true}')
    },
    log: () => {},
  }), /Dependencies changed during setup/)
  await assert.rejects(readFile(stampPath(root)), { code: 'ENOENT' })
})

test('preview inspection recognizes bounded streamed HTML and requests abort/redirect protection', async () => {
  const { response, observed } = previewResponse([encode(previewHtml.slice(0, 19)), encode(previewHtml.slice(19))])
  const requests = []
  assert.equal(await inspectPreview(PREVIEW_URL, {
    timeoutMs: 250,
    fetchImpl: async (url, options) => { requests.push({ url, options }); return response },
  }), 'ready')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, PREVIEW_URL)
  assert.equal(requests[0].options.redirect, 'error')
  assert.ok(requests[0].options.signal instanceof AbortSignal)
  assert.equal(observed.cancels, 1)
})

test('preview inspection accepts the size limit but rejects excess bytes even with valid markers', async () => {
  for (const [length, expected] of [[65_536, 'ready'], [65_537, 'occupied']]) {
    const html = previewHtml + ' '.repeat(length - encode(previewHtml).byteLength)
    const { response, observed } = previewResponse([encode(html)])
    assert.equal(await inspectPreview(PREVIEW_URL, { fetchImpl: async () => response }), expected)
    assert.equal(observed.cancels, 1)
  }
  const { response, observed } = previewResponse([new Uint8Array(65_537), encode(previewHtml)])
  assert.equal(await inspectPreview(PREVIEW_URL, { fetchImpl: async () => response }), 'occupied')
  assert.equal(observed.reads, 1, 'oversized content must stop further body reads')
  assert.equal(observed.cancels, 1)
})

test('preview inspection rejects unrelated HTML, redirected/non-success responses and missing bodies', async () => {
  for (const html of ['', '<title>Other app</title><script src="/@vite/client"></script>', '<title>Cyber Intelligence Lab</title>']) {
    assert.equal(await inspectPreview(PREVIEW_URL, { fetchImpl: async () => new Response(html, { headers: previewHeaders() }) }), 'occupied')
  }
  for (const status of [301, 404, 500]) {
    const { response, observed } = previewResponse([encode(previewHtml)], { ok: false })
    response.status = status
    assert.equal(await inspectPreview(PREVIEW_URL, { fetchImpl: async () => response }), 'occupied')
    assert.equal(observed.reads, 0)
    assert.equal(observed.cancels, 1)
  }
  assert.equal(await inspectPreview(PREVIEW_URL, { fetchImpl: async () => new Response(null, { status: 204 }) }), 'occupied')
})

test('preview inspection requires the requested checkout identity and HTML content type before body reads', async () => {
  const root = 'requested-checkout'
  const valid = previewResponse([encode(previewHtml)], { headers: previewHeaders(root) })
  assert.equal(await inspectPreview(PREVIEW_URL, { root, fetchImpl: async () => valid.response }), 'ready')
  for (const headers of [
    { 'Content-Type': 'text/html' },
    previewHeaders('different-checkout'),
    { ...previewHeaders(root), 'Content-Type': 'application/json' },
    { 'x-cyber-lab-preview': previewIdentity(root) },
  ]) {
    const { response, observed } = previewResponse([encode(previewHtml)], { headers })
    assert.equal(await inspectPreview(PREVIEW_URL, { root, fetchImpl: async () => response }), 'occupied')
    assert.equal(observed.reads, 0)
    assert.equal(observed.cancels, 1)
  }
})

test('only connection refusal means stopped; timeout, redirect, stream and other network errors remain occupied', async () => {
  const refused = new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })
  assert.equal(await inspectPreview(PREVIEW_URL, { fetchImpl: async () => { throw refused } }), 'stopped')
  for (const error of [new DOMException('timed out', 'TimeoutError'), new TypeError('redirect forbidden'), new Error('network failure')]) {
    assert.equal(await inspectPreview(PREVIEW_URL, { fetchImpl: async () => { throw error } }), 'occupied')
  }
  const { response, observed } = previewResponse([], { readError: new Error('read failed'), cancelError: new Error('cancel failed') })
  assert.equal(await inspectPreview(PREVIEW_URL, { fetchImpl: async () => response }), 'occupied')
  assert.equal(observed.cancels, 1)
})

test('stopped preview installs before loading Vite and releases its lock after successful startup', async () => {
  const context = launcher()
  assert.deepEqual(await launchPreview(context.options), { server: context.server, reused: false })
  assert.deepEqual(context.calls, ['lock', 'inspect', 'dependencies', 'load-vite', 'create-server', 'listen', 'urls', 'release'])
  assert.ok(context.logs.some((message) => /Keep this terminal open/.test(message)))
})

test('ready preview is reused without installing, loading Vite or creating another server', async () => {
  const context = launcher({ inspect: async () => 'ready' })
  assert.deepEqual(await launchPreview(context.options), { server: undefined, reused: true })
  assert.deepEqual(context.calls, ['lock', 'state', 'release'])
  assert.ok(context.logs.some((message) => /already running/.test(message)))
  assert.ok(context.logs.includes(`  Local: ${PREVIEW_URL}`))
})

test('existing preview with unknown dependencies is reusable but known changed dependencies require a restart', async () => {
  const unknown = launcher({ inspect: async () => 'ready', state: async () => ({ known: false, installNeeded: true }) })
  assert.equal((await launchPreview(unknown.options)).reused, true)
  assert.deepEqual(unknown.calls, ['lock', 'release'])
  const changed = launcher({ inspect: async () => 'ready', state: async () => ({ known: true, installNeeded: true }) })
  await assert.rejects(launchPreview(changed.options), /Stop its terminal with Ctrl\+C/)
  assert.deepEqual(changed.calls, ['lock', 'release'])
})

test('occupied preview preserves the conflicting process and does not install or launch', async () => {
  const context = launcher({ inspect: async () => 'occupied', open: true })
  await assert.rejects(launchPreview(context.options), /No process was stopped/)
  assert.deepEqual(context.calls, ['lock', 'release'])
})

test('dependency failure releases the startup lock and never loads Vite or opens a browser', async () => {
  const failure = new Error('locked installation failed')
  const context = launcher({ dependencies: async () => { throw failure }, open: true })
  await assert.rejects(launchPreview(context.options), (error) => error === failure)
  assert.deepEqual(context.calls, ['lock', 'inspect', 'release'])
})

test('Vite load/create/listen failures release the startup lock and failed listen closes its server', async () => {
  const failure = new Error('startup failed')
  for (const phase of ['load', 'create', 'listen']) {
    const context = launcher()
    if (phase === 'load') context.options.loadVite = async () => { throw failure }
    if (phase === 'create') context.options.loadVite = async () => ({ createServer: async () => { throw failure } })
    if (phase === 'listen') context.server.listen = async () => { context.calls.push('listen'); throw failure }
    await assert.rejects(launchPreview(context.options), (error) => error === failure)
    assert.equal(context.calls.at(-1), 'release', phase)
    assert.equal(context.calls.includes('close'), phase === 'listen', phase)
    assert.equal(context.calls.includes('urls'), false, phase)
    assert.equal(context.calls.includes('browse'), false, phase)
  }
})

test('browser opens only after lock release; browser-launch failure leaves the working preview available', async () => {
  const opened = launcher({ open: true })
  await launchPreview(opened.options)
  assert.deepEqual(opened.calls.slice(-2), ['release', 'browse'])
  const failed = launcher({ open: true, browse: async () => { throw new Error('no browser configured') } })
  assert.equal((await launchPreview(failed.options)).server, failed.server)
  assert.ok(failed.logs.includes(`The preview is ready. Open ${PREVIEW_URL} in your browser.`))
  const reused = launcher({ inspect: async () => 'ready', open: true })
  assert.equal((await launchPreview(reused.options)).reused, true)
  assert.deepEqual(reused.calls.slice(-2), ['release', 'browse'])
})

test('browser opener rejects arbitrary and alternate-loopback URLs before spawning anything', async () => {
  for (const url of ['https://example.com/', 'http://localhost:5173/', 'http://127.0.0.1:5174/', `${PREVIEW_URL}command`]) {
    await assert.rejects(openBrowser(url), /Only the local Cyber Intelligence Lab preview/)
  }
})

test('command runner resolves successful children and reports exit and spawn failures', async (t) => {
  await runCommand(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' })
  await assert.rejects(runCommand(process.execPath, ['-e', 'process.exit(7)'], { stdio: 'ignore' }), /exit 7/)
  const root = await workspace(t)
  await assert.rejects(runCommand(join(root, 'missing-executable'), [], { stdio: 'ignore' }), { code: 'ENOENT' })
})

test('startup lock serializes one workspace and can be reacquired after owner release', async (t) => {
  const root = await workspace(t)
  const release = await acquireStartupLock(root)
  t.after(release)
  await assert.rejects(acquireStartupLock(root, { timeoutMs: 0, pollMs: 1 }), /Another preview launch is still running/)
  await release()
  const releaseAgain = await acquireStartupLock(root, { timeoutMs: 0, pollMs: 1 })
  t.after(releaseAgain)
  await releaseAgain()
})

function lockPath(root) {
  const key = createHash('sha256').update(resolve(root).toLowerCase()).digest('hex').slice(0, 24)
  return join(tmpdir(), `cyber-lab-preview-${key}.lock`)
}

test('a dead-owner startup lock is preserved with exact-path recovery guidance, not automatically deleted', async (t) => {
  const root = await workspace(t)
  const path = lockPath(root)
  t.after(() => rm(path, { force: true }))
  const { stdout } = await exec(process.execPath, ['-e', 'console.log(process.pid)'])
  const owner = JSON.stringify({ pid: Number(stdout.trim()), token: 'interrupted-install' })
  await writeFile(path, owner)
  await assert.rejects(acquireStartupLock(root, { timeoutMs: 0, pollMs: 1 }), (error) => {
    assert.match(error.message, /interrupted preview launch/)
    assert.ok(error.message.includes(`remove only "${path}"`))
    return true
  })
  assert.equal(await readFile(path, 'utf8'), owner)
})

test('old malformed startup locks require manual recovery, while recent incomplete locks are not removed', async (t) => {
  const root = await workspace(t)
  const path = lockPath(root)
  t.after(() => rm(path, { force: true }))
  await writeFile(path, '{incomplete')
  await utimes(path, new Date(0), new Date(0))
  await assert.rejects(acquireStartupLock(root, { timeoutMs: 0, pollMs: 1 }), /interrupted preview launch/)
  assert.equal(await readFile(path, 'utf8'), '{incomplete')
  await utimes(path, new Date('2100-01-01T00:00:00Z'), new Date('2100-01-01T00:00:00Z'))
  await assert.rejects(acquireStartupLock(root, { timeoutMs: 0, pollMs: 1 }), /Another preview launch is still running/)
  assert.equal(await readFile(path, 'utf8'), '{incomplete')
})

test('releasing a startup lock cannot delete a replacement with a different ownership token', async (t) => {
  const root = await workspace(t)
  const path = lockPath(root)
  t.after(() => rm(path, { force: true }))
  const release = await acquireStartupLock(root)
  const original = JSON.parse(await readFile(path, 'utf8'))
  const replacement = { ...original, token: 'replacement-owner' }
  await writeFile(path, JSON.stringify(replacement))
  await release()
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), replacement)
})
