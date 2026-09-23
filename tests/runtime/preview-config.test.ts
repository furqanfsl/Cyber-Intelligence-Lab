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

test('Go Live forwards the entire app and API to the fixed Vite server', () => {
  const proxy = settings['liveServer.settings.proxy']
  assert.equal(proxy.enable, true)
  assert.equal(proxy.baseUri, '/')
  assert.equal(proxy.proxyUri, `http://${config.server.host}:${config.server.port}`)
  assert.equal(config.server.host, '127.0.0.1')
  assert.equal(config.server.port, 5173)
  assert.equal(config.server.strictPort, true)
  assert.notEqual(settings['liveServer.settings.port'], config.server.port)
})

test('Go Live hot reload connects directly to Vite rather than the static proxy', () => {
  const hmr = config.server.hmr
  assert.ok(hmr && typeof hmr === 'object')
  assert.equal(hmr.host, config.server.host)
  assert.equal(hmr.clientPort, config.server.port)
})

test('the default VS Code task starts Vite and detects its ready message', () => {
  const task = tasks.tasks.find((candidate: { label: string }) => candidate.label === 'Start Cyber Intelligence Lab')
  assert.ok(task)
  assert.equal(task.type, 'npm')
  assert.equal(task.script, 'dev')
  assert.equal(task.group.isDefault, true)
  assert.equal(task.isBackground, true)
  assert.equal(task.runOptions.instanceLimit, 1)
  assert.match(`  ➜  Local:   http://${config.server.host}:${config.server.port}/`,
    new RegExp(task.problemMatcher.background.endsPattern))
})
