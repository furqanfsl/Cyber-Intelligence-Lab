import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { win32 } from 'node:path'
import { createEndpointProvider, parseEndpointRead } from '../../backend/endpoint-provider.ts'

const since = '2026-10-09T11:45:00.000Z'
const until = '2026-10-09T12:00:00.000Z'
function payload() { return {
  collectedAt: until,
  defender: { state: 'available', antivirusEnabled: true, realTimeProtectionEnabled: true, signaturesUpdatedAt: until },
  coverage: ['defender', 'security', 'sysmon'].map((source) => ({ source, state: source === 'sysmon' ? 'not-requested' : 'available', eventCount: 0, truncated: false, skippedCount: 0 })),
  defenderEvents: [], events: [],
} }
function child() {
  const value = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => { value.emit('close', null, 'SIGTERM'); return true } })
  return value
}

test('endpoint provider is unsupported off Windows and validates query before spawning', async () => {
  let calls = 0
  const provider = createEndpointProvider({ platform: 'linux', spawn: (() => { calls += 1; throw new Error() }) as never })
  await assert.rejects(provider.read({ since, until, includeSysmon: false, signal: new AbortController().signal }), /Windows/i)
  assert.equal(calls, 0)
  const local = createEndpointProvider({ platform: 'win32', spawn: (() => { calls += 1; throw new Error() }) as never })
  for (const request of [{ since: 'bad', until }, { since: until, until: since }, { since: '2026-10-08T12:00:00.000Z', until }]) {
    await assert.rejects(local.read({ ...request, includeSysmon: false, signal: new AbortController().signal }), /time range/i)
  }
  assert.equal(calls, 0)
})

test('endpoint provider spawns only fixed noninteractive script arguments without shell interpolation', async () => {
  const process = child()
  const provider = createEndpointProvider({ platform: 'win32', spawn: ((file: string, args: string[], options: Record<string, unknown>) => {
    assert.match(file, /[\\/]WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/i)
    assert.equal(options.shell, false)
    assert.equal(options.windowsHide, true)
    assert.deepEqual(args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-File'])
    assert.match(args[4], /scripts[\\/]read-endpoint\.ps1$/)
    assert.ok(args.includes('-IncludeSysmon'))
    queueMicrotask(() => { process.stdout.end(JSON.stringify(payload())); process.emit('close', 0) })
    return process
  }) as never })
  const result = await provider.read({ since, until, includeSysmon: true, signal: new AbortController().signal })
  assert.equal(result.defender.realTimeProtectionEnabled, true)
})

test('endpoint provider bounds stdout and stderr and never exposes private errors', async () => {
  for (const stream of ['stdout', 'stderr'] as const) {
    const process = child()
    let killed = 0
    process.kill = () => { killed += 1; process.emit('close', null); return true }
    const provider = createEndpointProvider({ platform: 'win32', maxBytes: 256, spawn: (() => {
      queueMicrotask(() => { process[stream].write('private-user-path'.repeat(100)) })
      return process
    }) as never })
    await assert.rejects(provider.read({ since, until, includeSysmon: false, signal: new AbortController().signal }), (error: unknown) => error instanceof Error && /limit/.test(error.message) && !/private-user/.test(error.message))
    assert.equal(killed, 1)
  }
})

test('endpoint provider abort and deadline terminate only own helper, and no helper starts for pre-abort', async () => {
  for (const deadline of [true, false]) {
    const process = child()
    let killed = 0
    process.kill = () => { killed += 1; process.emit('close', null); return true }
    const controller = new AbortController()
    const provider = createEndpointProvider({ platform: 'win32', timeoutMs: 5, spawn: (() => process) as never })
    const pending = provider.read({ since, until, includeSysmon: false, signal: controller.signal })
    if (!deadline) controller.abort()
    await assert.rejects(pending, /stopped|deadline/)
    assert.equal(killed, 1)
  }
  const controller = new AbortController(); controller.abort()
  await assert.rejects(createEndpointProvider({ platform: 'win32', spawn: (() => { throw new Error('must not run') }) as never }).read({ since, until, includeSysmon: false, signal: controller.signal }), /stopped/)
})

test('endpoint parser returns allowlisted fields and preserves unavailable vs no-event coverage', () => {
  const raw = payload()
  raw.coverage[1].state = 'unavailable'
  const parsed = parseEndpointRead({ ...raw, secretPath: 'do-not-return', defender: { ...raw.defender, hidden: 'do-not-return' } })
  assert.equal(parsed.coverage[0].state, 'available')
  assert.equal(parsed.coverage[1].state, 'unavailable')
  assert.doesNotMatch(JSON.stringify(parsed), /do-not-return|hidden|secretPath/)
})

test('endpoint parser rejects invalid fields, unbounded arrays, malformed timestamps, and contradictions', () => {
  for (const value of [null, {}, { ...payload(), collectedAt: '2026-02-30T00:00:00.000Z' }, { ...payload(), coverage: [] }, { ...payload(), events: Array(501).fill({}) }, { ...payload(), defenderEvents: [{ id: 'x', eventId: 1 }] }, { ...payload(), defender: { ...payload().defender, antivirusEnabled: 'true' } }]) {
    assert.throws(() => parseEndpointRead(value), /endpoint/i)
  }
})

test('endpoint parser canonicalizes actual Security/Sysmon records and sanitizes Defender record extras', () => {
  const raw = { ...payload(), events: [{ timestamp: until, host: 'synthetic-host', user: 'synthetic-user', sourceIp: '192.0.2.1', process: '', commandLine: '', channel: 'Security', eventId: 4625, id: 'untrusted' }],
    defenderEvents: [{ id: 'defender-1', timestamp: until, eventId: 1116, detectionId: '{ABC}', threatId: '42', threatName: 'Test/Synthetic', severity: 'high', actionId: null, errorCode: '', path: 'do-not-return', xml: 'do-not-return' }] }
  raw.coverage[0].eventCount = 1
  raw.coverage[1].eventCount = 1
  const parsed = parseEndpointRead(raw)
  assert.match(parsed.events[0].id, /^evt-/)
  assert.equal(parsed.defenderEvents[0].detectionId, '{abc}')
  assert.doesNotMatch(JSON.stringify(parsed), /do-not-return|untrusted/)
})

test('helper nonzero exits, spawn errors and malformed UTF-8 are sanitized', async () => {
  for (const failure of ['exit', 'error', 'utf8', 'invalid-json']) {
    const process = child()
    const provider = createEndpointProvider({ platform: 'win32', spawn: (() => {
      queueMicrotask(() => {
        if (failure === 'error') process.emit('error', new Error('private-user-path'))
        else {
          process.stdout.end(failure === 'utf8' ? Buffer.from([0xff]) : 'private-user-path')
          process.stderr.end('private-user-path')
          process.emit('close', failure === 'exit' ? 1 : 0)
        }
      })
      return process
    }) as never })
    await assert.rejects(provider.read({ since, until, includeSysmon: false, signal: new AbortController().signal }), (error: unknown) => error instanceof Error && !/private-user-path/.test(error.message))
  }
})

test('provider accepts a BOM and split UTF-8 without corrupting non-ASCII names', async () => {
  const raw = payload()
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(raw))])
  const process = child()
  const provider = createEndpointProvider({ platform: 'win32', spawn: (() => {
    queueMicrotask(() => { for (const byte of bytes) process.stdout.write(Buffer.from([byte])); process.stdout.end(); process.emit('close', 0) })
    return process
  }) as never })
  assert.equal((await provider.read({ since, until, includeSysmon: false, signal: new AbortController().signal })).collectedAt, until)
})

test('provider refuses limits outside safety ceilings', () => {
  for (const timeoutMs of [0, -1, NaN, Infinity, 30_001, 1.5]) assert.throws(() => createEndpointProvider({ timeoutMs }), /timeoutMs/)
  for (const maxBytes of [0, -1, NaN, Infinity, 5 * 1024 * 1024 + 1, 1.5]) assert.throws(() => createEndpointProvider({ maxBytes }), /maxBytes/)
})

test('parser rejects duplicate sources, unsupported sources, field controls, and count contradictions', () => {
  const base = payload()
  const falseCount = payload(); falseCount.coverage[1].eventCount = 1
  const unavailableCount = payload(); unavailableCount.coverage[1].state = 'unavailable'; unavailableCount.coverage[1].eventCount = 1
  for (const raw of [falseCount, unavailableCount, { ...base, coverage: [base.coverage[0], base.coverage[0], base.coverage[2]] }, { ...base, coverage: [base.coverage[0], { ...base.coverage[1], source: 'network' }, base.coverage[2]] }]) assert.throws(() => parseEndpointRead(raw), /endpoint/)
  const event = { id: 'discarded', timestamp: until, eventId: 1116, detectionId: 'x', threatId: '42', threatName: 'Synthetic', severity: 'high', actionId: null, errorCode: '' }
  for (const changes of [{ threatName: '\u0001' }, { threatName: '\ud800' }, { threatName: 'x'.repeat(513) }, { errorCode: 'private path' }, { actionId: -1 }, { severity: 'urgent' }, { timestamp: '2026-10-09T12:00:00+00:00' }]) assert.throws(() => parseEndpointRead({ ...base, defenderEvents: [{ ...event, ...changes }] }), /endpoint/)
})

test('real PowerShell helper normalizes only synthetic mocked telemetry with precise source health', { skip: process.platform !== 'win32' }, () => {
  const executable = win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const harness = fileURLToPath(new URL('./endpoint-helper.mock.ps1', import.meta.url))
  const helper = fileURLToPath(new URL('../../scripts/read-endpoint.ps1', import.meta.url))
  for (const scenario of ['events', 'empty', 'disabled', 'unavailable', 'bad-fields', 'truncated']) {
    const result = spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', harness, '-HelperPath', helper, '-Scenario', scenario], { windowsHide: true, timeout: 15_000, maxBuffer: 5 * 1024 * 1024 })
    assert.equal(result.status, 0, `Synthetic helper scenario ${scenario} must complete.`)
    assert.equal(result.stderr.length, 0, `Synthetic helper scenario ${scenario} emitted diagnostics.`)
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(result.stdout)
    assert.doesNotMatch(raw, /synthetic-private-(?:path|user|error)/)
    const parsed = parseEndpointRead(JSON.parse(raw))
    if (scenario === 'events') {
      assert.equal(parsed.events.length, 2)
      assert.equal(parsed.defenderEvents.length, 2)
      assert.equal(parsed.events.find((event) => event.channel === 'Security')!.user, 'synthetic-domain\\synthetic-user')
      assert.equal(parsed.defenderEvents[1].actionId, 6)
      assert.equal(parsed.defenderEvents[0].severity, 'high')
    } else if (scenario === 'empty') {
      assert.ok(parsed.coverage.every((source) => source.state === 'available' && source.eventCount === 0))
    } else if (scenario === 'disabled' || scenario === 'unavailable') {
      assert.ok(parsed.coverage.every((source) => source.state === 'unavailable'))
      assert.equal(parsed.events.length, 0)
      if (scenario === 'unavailable') assert.equal(parsed.defender.state, 'unavailable')
    } else if (scenario === 'bad-fields') {
      assert.equal(parsed.coverage[1].eventCount, 0)
      assert.equal(parsed.coverage[1].skippedCount, 1)
    } else {
      assert.equal(parsed.coverage[1].eventCount, 250)
      assert.equal(parsed.coverage[1].truncated, true)
    }
  }
})

test('live parser rejects Sysmon network context, noncanonical channels and source count overflow', () => {
  for (const event of [
    { timestamp: until, host: 'synthetic-host', user: '', sourceIp: '', process: '', commandLine: '', channel: 'Sysmon', eventId: 3 },
    { timestamp: until, host: 'synthetic-host', user: '', sourceIp: '', process: '', commandLine: '', channel: 'Microsoft-Windows-Sysmon/Operational', eventId: 1 },
    { timestamp: until, host: 'synthetic-host', user: '', sourceIp: '', process: '', commandLine: '', channel: 'Security ', eventId: 4625 },
  ]) {
    const raw = payload(); raw.coverage[2] = { source: 'sysmon', state: 'available', eventCount: 1, skippedCount: 0, truncated: false }
    assert.throws(() => parseEndpointRead({ ...raw, events: [event] }), /endpoint/)
  }
  for (const coverage of [
    { source: 'defender', state: 'available', eventCount: 0, skippedCount: 201, truncated: false },
    { source: 'security', state: 'available', eventCount: 0, skippedCount: 250, truncated: false },
    { source: 'security', state: 'available', eventCount: 0, skippedCount: 1, truncated: true },
  ]) {
    const raw = payload()
    const index = coverage.source === 'defender' ? 0 : 1
    raw.coverage[index] = coverage
    if (coverage.source === 'security' && coverage.skippedCount === 250) {
      assert.equal(parseEndpointRead(raw).coverage[1].skippedCount, 250)
      const event = { timestamp: until, host: 'synthetic-host', user: '', sourceIp: '', process: '', commandLine: '', channel: 'Security', eventId: 4625 }
      raw.coverage[1].eventCount = 1
      assert.throws(() => parseEndpointRead({ ...raw, events: [event] }), /endpoint/)
    } else assert.throws(() => parseEndpointRead(raw), /endpoint/)
  }
})
