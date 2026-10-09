import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { previewIdentity } from '../server/preview-identity.ts'

export const PREVIEW_URL = 'http://127.0.0.1:5173/'
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const STAMP = 'node_modules/.cache/cyber-lab-preview-dependencies.json'
const delay = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds))

export function parseArguments(args) {
  if (args.some((argument) => !['--open', '--help'].includes(argument))) {
    throw new Error('Unknown option. Use npm run dev, or npm run dev -- --open.')
  }
  return { open: args.includes('--open'), help: args.includes('--help') }
}

// A listening but unrelated (or unresponsive) process must never be replaced.
export async function inspectPreview(url = PREVIEW_URL, { root = PROJECT_ROOT, timeoutMs = 2_000, fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' })
    if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/html')
      || response.headers.get('x-cyber-lab-preview') !== previewIdentity(root)) {
      await response.body?.cancel()
      return 'occupied'
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let html = ''
    let bytes = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > 65_536) return 'occupied'
        html += decoder.decode(value, { stream: true })
      }
      html += decoder.decode()
    } finally {
      await reader.cancel().catch(() => {})
    }
    return html.includes('/@vite/client') && html.includes('<title>Cyber Intelligence Lab</title>')
      ? 'ready' : 'occupied'
  } catch (error) {
    return error?.cause?.code === 'ECONNREFUSED' ? 'stopped' : 'occupied'
  }
}

export async function dependencyState(root = PROJECT_ROOT) {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const lock = await readFile(join(root, 'package-lock.json'), 'utf8')
  const relevant = Object.fromEntries(['dependencies', 'devDependencies', 'optionalDependencies', 'overrides', 'engines', 'packageManager']
    .map((key) => [key, manifest[key]]))
  const fingerprint = createHash('sha256').update(lock).update(JSON.stringify(relevant)).digest('hex')
  let stamp
  try { stamp = JSON.parse(await readFile(join(root, STAMP), 'utf8')) } catch { /* first launch or interrupted setup */ }
  let installed = false
  try { installed = (await stat(join(root, 'node_modules/vite/dist/node/index.js'))).isFile() } catch { /* install needed */ }
  return { fingerprint, installNeeded: !installed || stamp?.fingerprint !== fingerprint, known: Boolean(stamp?.fingerprint) }
}

export function runCommand(command, args, options = {}) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', windowsHide: true, ...options })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) done()
      else reject(new Error(`${command} did not finish successfully (${signal ?? `exit ${code}`}).`))
    })
  })
}

export async function installDependencies(root = PROJECT_ROOT) {
  // Only fixed npm arguments enter the Windows shell; cwd is passed separately.
  if (process.platform === 'win32') {
    await runCommand(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm ci'], { cwd: root })
  } else {
    await runCommand('npm', ['ci'], { cwd: root })
  }
}

export async function ensureDependencies(root = PROJECT_ROOT, { install = installDependencies, log = console.log } = {}) {
  const before = await dependencyState(root)
  if (!before.installNeeded) return false
  log('Installing locked dependencies with npm ci. This may take a moment...')
  await install(root)
  const after = await dependencyState(root)
  if (after.fingerprint !== before.fingerprint) {
    throw new Error('Dependencies changed during setup. Run the launcher again.')
  }
  const entry = await stat(join(root, 'node_modules/vite/dist/node/index.js')).catch(() => null)
  if (!entry?.isFile()) throw new Error('Dependency installation did not provide Vite. Run npm ci and try again.')
  await mkdir(dirname(join(root, STAMP)), { recursive: true })
  await writeFile(join(root, STAMP), JSON.stringify({ fingerprint: after.fingerprint }) + '\n')
  return true
}

function processExists(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false
  try { process.kill(pid, 0); return true } catch (error) { return error.code !== 'ESRCH' }
}

// npm ci replaces node_modules, so the startup lock lives in the temp directory.
export async function acquireStartupLock(root = PROJECT_ROOT, { timeoutMs = 300_000, pollMs = 200 } = {}) {
  const key = createHash('sha256').update(resolve(root).toLowerCase()).digest('hex').slice(0, 24)
  const path = join(tmpdir(), `cyber-lab-preview-${key}.lock`)
  const token = randomUUID()
  const deadline = Date.now() + timeoutMs
  while (true) {
    try {
      const handle = await open(path, 'wx')
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, token })) } finally { await handle.close() }
      return async () => {
        const owner = await readFile(path, 'utf8').then(JSON.parse).catch(() => null)
        if (owner?.token === token) await rm(path, { force: true })
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const owner = await readFile(path, 'utf8').then(JSON.parse).catch(() => null)
      const age = await stat(path).then((info) => Date.now() - info.mtimeMs).catch(() => 0)
      if ((owner && !processExists(owner.pid)) || (!owner && age > 10_000)) {
        // Never delete a lock using an earlier observation: another launcher
        // could already own its replacement. Interrupted setup needs review.
        throw new Error(`An interrupted preview launch left a startup lock. Close this project's startup terminals, remove only "${path}", then retry.`)
      }
      if (Date.now() >= deadline) throw new Error('Another preview launch is still running. Wait for its terminal to finish, then try again.')
      await delay(pollMs)
    }
  }
}

export async function openBrowser(url = PREVIEW_URL) {
  if (url !== PREVIEW_URL) throw new Error('Only the local Cyber Intelligence Lab preview can be opened.')
  if (process.platform === 'win32') {
    await runCommand(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'start', '""', PREVIEW_URL], { stdio: 'ignore' })
  } else {
    await runCommand(process.platform === 'darwin' ? 'open' : 'xdg-open', [PREVIEW_URL], { stdio: 'ignore' })
  }
}

export async function launchPreview({ root = PROJECT_ROOT, open: shouldOpen = false, inspect = inspectPreview,
  dependencies = ensureDependencies, state = dependencyState, lock = acquireStartupLock,
  loadVite = () => import('vite'), browse = openBrowser, log = console.log } = {}) {
  const release = await lock(root)
  let server
  let reused = false
  try {
    const status = await inspect(PREVIEW_URL, { root })
    if (status === 'occupied') {
      throw new Error('Port 5173 is occupied or not responding as this app. Close the conflicting preview yourself, then try again. No process was stopped.')
    }
    if (status === 'ready') {
      const current = await state(root)
      if (current.known && current.installNeeded) {
        throw new Error('Dependencies changed while the preview was running. Stop its terminal with Ctrl+C, then run this launcher again to install the update.')
      }
      reused = true
      log('Cyber Intelligence Lab is already running; reusing the preview.')
      log(`  Local: ${PREVIEW_URL}`)
    } else {
      log('VITE preview starting')
      await dependencies(root)
      const vite = await loadVite()
      server = await vite.createServer({ root, clearScreen: false, server: { host: '127.0.0.1', port: 5173, strictPort: true, open: false } })
      try { await server.listen() } catch (error) { await server.close(); throw error }
      server.printUrls()
      log('Keep this terminal open. Press Ctrl+C to stop the preview.')
    }
  } finally {
    await release()
  }
  if (shouldOpen) {
    try { await browse() } catch { log(`The preview is ready. Open ${PREVIEW_URL} in your browser.`) }
  }
  return { server, reused }
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args)
  if (options.help) {
    console.log(`Usage: npm run dev [-- --open]\nPreview: ${PREVIEW_URL}\nStarts or reuses this project's preview; installs locked dependencies when needed.`)
    return
  }
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 or later is required. Update Node.js, then try again.')
  const { server } = await launchPreview(options)
  if (server) {
    let closing = false
    const stop = async () => {
      if (closing) return
      closing = true
      await server.close()
      process.exit(0)
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`\nCould not start Cyber Intelligence Lab: ${error.message}`)
    console.error('Check the message above, then run start.bat or npm run dev again.')
    process.exitCode = 1
  })
}
