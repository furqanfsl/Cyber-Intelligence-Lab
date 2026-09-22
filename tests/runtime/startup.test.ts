import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const ENTRY = fileURLToPath(new URL('../../runtime/server.ts', import.meta.url))

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
