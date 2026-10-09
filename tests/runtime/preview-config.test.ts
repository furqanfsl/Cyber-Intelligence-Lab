import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { resolveConfig } from 'vite'

const root = new URL('../../', import.meta.url)
const settings = JSON.parse(await readFile(new URL('.vscode/settings.json', root), 'utf8'))
const tasks = JSON.parse(await readFile(new URL('.vscode/tasks.json', root), 'utf8'))
const config = await resolveConfig({
  root: fileURLToPath(root),
  configFile: fileURLToPath(new URL('vite.config.ts', root)),
}, 'serve')

test('Go Live serves an independent launcher, never a proxy to a stopped process', async () => {
  const proxy = settings['liveServer.settings.proxy']
  assert.equal(proxy.enable, false)
  assert.equal(settings['liveServer.settings.root'], '/preview')
  assert.equal(settings['liveServer.settings.file'], 'index.html')
  const launcher = await readFile(new URL('preview/index.html', root), 'utf8')
  assert.match(launcher, /id="launch-status"/)
  assert.match(launcher, /start\.bat/)
  assert.equal(config.server.host, '127.0.0.1')
  assert.equal(config.server.port, 5173)
  assert.equal(config.server.strictPort, true)
  assert.notEqual(settings['liveServer.settings.port'], config.server.port)
})

test('only local Go Live origins can read Vite readiness across origins', () => {
  assert.deepEqual(config.server.cors, {
    origin: ['http://127.0.0.1:5500', 'http://localhost:5500', 'http://[::1]:5500'],
  })
})

test('the default VS Code task starts Vite and detects its ready message', () => {
  const task = tasks.tasks.find((candidate: { label: string }) => candidate.label === 'Start Cyber Intelligence Lab')
  assert.ok(task)
  assert.equal(task.type, 'npm')
  assert.equal(task.script, 'dev')
  assert.equal(task.group.isDefault, true)
  assert.equal(task.isBackground, true)
  assert.equal(task.runOptions.instanceLimit, 1)
  assert.equal(task.runOptions.runOn, 'folderOpen')
  assert.match(`  ➜  Local:   http://${config.server.host}:${config.server.port}/`,
    new RegExp(task.problemMatcher.background.endsPattern))
})

test('README describes terminal-printed local startup without public-demo-like loopback links', async () => {
  const readme = await readFile(new URL('README.md', root), 'utf8')
  const script = await readFile(new URL('preview/launch.js', root), 'utf8')
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(pkg.scripts.dev, 'node scripts/dev.mjs')
  assert.equal(pkg.scripts['verify:local'], 'node scripts/verify-local.mjs')
  assert.match(readme, /Open the local address printed in the terminal in your browser/)
  assert.match(readme, /not a public demo/)
  assert.match(readme, /Keep the server\s+running/)
  assert.doesNotMatch(readme, /https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])/i)
  assert.match(readme, /port `5173`/)
  assert.match(readme, /port `5500`/)
  assert.ok(script.includes(`http://${config.server.host}:${config.server.port}/`))
})
