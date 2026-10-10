import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = (name) => readFile(resolve(root, name), 'utf8')

test('readable product folders retain the standard tool and launcher filenames', async () => {
  for (const name of ['app', 'backend', 'app-server', 'shared-types', 'guides']) {
    assert.ok((await readdir(resolve(root, name))).length > 0, `${name} must contain its moved files`)
  }
  for (const name of ['src', 'server', 'runtime', 'shared', 'docs']) {
    await assert.rejects(access(resolve(root, name)), { code: 'ENOENT' })
  }
  for (const name of ['package.json', 'package-lock.json', 'index.html', 'vite.config.ts', 'start.bat', 'preview/index.html', '.vscode/settings.json']) {
    await access(resolve(root, name))
  }
})

test('development, production and coverage entry paths match the moved product files', async () => {
  const pkg = JSON.parse(await read('package.json'))
  assert.equal(pkg.scripts.start, 'node app-server/server.ts')
  await access(resolve(root, pkg.scripts.start.slice('node '.length)))
  assert.match(await read('index.html'), /src="\/app\/main\.tsx"/)
  assert.ok((await read('scripts/verify-local.mjs')).includes('app/main.tsx'))
  const appConfig = ts.parseConfigFileTextToJson('tsconfig.app.json', await read('tsconfig.app.json'))
  assert.equal(appConfig.error, undefined)
  assert.deepEqual(appConfig.config.include, ['app'])
  const parsedNodeConfig = ts.parseConfigFileTextToJson('tsconfig.node.json', await read('tsconfig.node.json'))
  assert.equal(parsedNodeConfig.error, undefined)
  const nodeConfig = parsedNodeConfig.config
  for (const glob of ['backend/**/*.ts', 'app-server/**/*.ts', 'shared-types/**/*.ts']) assert.ok(nodeConfig.include.includes(glob))
  for (const glob of ['backend/**/*.ts', 'app-server/**/*.ts', 'app/lib/**/*.ts']) assert.ok(pkg.scripts['test:coverage'].includes(glob))
  for (const gate of ['--test-coverage-lines=90', '--test-coverage-branches=85', '--test-coverage-functions=85']) assert.ok(pkg.scripts['test:coverage'].includes(gate))
})

test('README and guides retain working relative documentation and asset links', async () => {
  const documents = ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', ...(await readdir(resolve(root, 'guides'))).filter((name) => name.endsWith('.md')).map((name) => `guides/${name}`)]
  let checked = 0
  for (const name of documents) {
    const content = (await read(name)).replace(/```[\s\S]*?```/g, '')
    for (const match of content.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)) {
      const link = match[1]
      if (/^(?:https?:|mailto:|#)/.test(link)) continue
      const target = decodeURIComponent(link.split('#')[0])
      await access(resolve(root, dirname(name), target))
      checked += 1
    }
  }
  assert.ok(checked >= 20, 'the moved guide links must actually be exercised')
})
