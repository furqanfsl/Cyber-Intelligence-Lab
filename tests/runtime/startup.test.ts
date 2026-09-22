import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test, { type TestContext } from 'node:test'

const ENTRY = fileURLToPath(new URL('../../runtime/server.ts', import.meta.url))

async function deployment(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'cyber-lab-deploy-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const directory of ['runtime', 'server', 'shared']) {
    await cp(fileURLToPath(new URL(`../../${directory}/`, import.meta.url)), join(root, directory), { recursive: true })
  }
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }))
  await mkdir(join(root, 'dist'))
  await writeFile(join(root, 'dist', 'index.html'), '<title>Isolated deployment fixture</title>')
  return join(root, 'runtime', 'server.ts')
}

test('CLI rejects invalid deployment environment with a safe nonzero exit', () => {
  for (const environment of [{ PORT: 'invalid', HOST: '127.0.0.1' }, { PORT: '3000', HOST: 'https://example.com' }]) {
    const result = spawnSync(process.execPath, [ENTRY], {
      cwd: tmpdir(), env: { ...process.env, ...environment },
      encoding: 'utf8', timeout: 5_000, windowsHide: true,
    })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /(?:PORT|HOST) must be/)
    assert.doesNotMatch(result.stderr, /at |server\.ts|Error:/)
  }
})

test('CLI reports an occupied port and exits without leaving a second server', async (t) => {
  const entry = await deployment(t)
  const occupied = createServer()
  occupied.listen(0, '127.0.0.1')
  await once(occupied, 'listening')
  t.after(() => new Promise<void>((resolve) => occupied.close(() => resolve())))
  const address = occupied.address()
  assert.ok(address && typeof address !== 'string')
  const result = spawnSync(process.execPath, [entry], {
    cwd: tmpdir(), env: { ...process.env, HOST: '127.0.0.1', PORT: String(address.port) },
    encoding: 'utf8', timeout: 5_000, windowsHide: true,
  })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /port is already in use/)
  assert.doesNotMatch(result.stderr, /at |server\.ts|Error:/)
  assert.equal(occupied.listening, true)
})

test('a standalone deployment starts from an unrelated working directory without node_modules', async (t) => {
  const entry = await deployment(t)
  const reservation = createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const address = reservation.address()
  assert.ok(address && typeof address !== 'string')
  const port = address.port
  await new Promise<void>((resolve) => reservation.close(() => resolve()))
  const child = spawn(process.execPath, [entry], {
    cwd: tmpdir(), env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  })
  let output = ''
  let errors = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => { errors += chunk })
  try {
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error(`Startup timed out: ${errors}`)), 5_000)
      child.once('error', (error) => { clearTimeout(deadline); reject(error) })
      child.once('exit', (code) => { clearTimeout(deadline); reject(new Error(`Startup exited ${code}: ${errors}`)) })
      child.stdout.on('data', (chunk: string) => {
        output += chunk
        if (output.includes(`http://127.0.0.1:${port}`)) { clearTimeout(deadline); resolve() }
      })
    })
    const homepage = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(3_000) })
    assert.equal(homepage.status, 200)
    assert.equal(await homepage.text(), '<title>Isolated deployment fixture</title>')
    const health = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(3_000) })
    assert.deepEqual(await health.json(), { status: 'ok' })
    assert.equal(errors, '')
  } finally {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'exit')
      child.kill()
      await closed
    }
  }
})
