import assert from 'node:assert/strict'
import test from 'node:test'
import { createEndpointMonitor, ENDPOINT_POLL_MS, ENDPOINT_RETENTION_MS } from '../../backend/endpoint-monitor.ts'
import type { EndpointRead, EndpointProvider } from '../../backend/endpoint-provider.ts'

const BASE = Date.parse('2026-10-09T12:00:00.000Z')
function read(time = BASE): EndpointRead {
  return {
    collectedAt: new Date(time).toISOString(),
    defender: { state: 'available', antivirusEnabled: true, realTimeProtectionEnabled: true, signaturesUpdatedAt: new Date(time).toISOString() },
    coverage: [
      { source: 'defender', state: 'available', eventCount: 0, truncated: false, skippedCount: 0 },
      { source: 'security', state: 'available', eventCount: 0, truncated: false, skippedCount: 0 },
      { source: 'sysmon', state: 'not-requested', eventCount: 0, truncated: false, skippedCount: 0 },
    ],
    defenderEvents: [], events: [],
  }
}
function setup(provider: EndpointProvider, platform = 'win32') {
  let time = BASE
  const timers = new Map<number, { callback: () => void; delay: number }>()
  let next = 0
  const monitor = createEndpointMonitor({ provider, platform, now: () => time,
    setTimeout: (callback, delay) => { timers.set(++next, { callback, delay }); return next },
    clearTimeout: (id) => { timers.delete(id as number) },
  })
  return { monitor, timers, advance: (value: number) => { time += value }, fire: async () => {
    const timer = [...timers.entries()][0]
    assert.ok(timer)
    timers.delete(timer[0]); timer[1].callback()
    await new Promise((resolve) => setImmediate(resolve))
  } }
}

test('endpoint monitor does not read until explicit start and unsupported platforms never read', async () => {
  let calls = 0
  const provider = { read: async () => { calls += 1; return read() } }
  const local = setup(provider)
  assert.equal(local.monitor.getSnapshot().status, 'idle')
  assert.equal(calls, 0)
  const unsupported = setup(provider, 'linux')
  assert.equal((await unsupported.monitor.start()).status, 'unsupported')
  assert.equal(calls, 0)
  assert.equal(unsupported.timers.size, 0)
  local.monitor.dispose()
})

test('explicit start is singleflight, bounded, schedules only after completion, and repeats', async () => {
  const requests: Parameters<EndpointProvider['read']>[0][] = []
  const state = setup({ read: async (request) => { requests.push(request); return read() } })
  await Promise.all([state.monitor.start(), state.monitor.start()])
  assert.equal(requests.length, 1)
  assert.equal(requests[0].includeSysmon, false)
  assert.equal(Date.parse(requests[0].until) - Date.parse(requests[0].since), 15 * 60_000)
  assert.equal([...state.timers.values()][0].delay, ENDPOINT_POLL_MS)
  state.advance(ENDPOINT_POLL_MS); await state.fire()
  assert.equal(requests.length, 2)
  assert.equal(state.monitor.getSnapshot().status, 'running')
  state.monitor.dispose()
  assert.equal(state.timers.size, 0)
})

test('stop aborts pending read and ignores late result without scheduling another poll', async () => {
  let pending: ((value: EndpointRead) => void) | undefined
  let signal: AbortSignal | undefined
  const state = setup({ read: async (request) => { signal = request.signal; return new Promise((resolve) => { pending = resolve }) } })
  const operation = state.monitor.start()
  assert.equal(state.timers.size, 0)
  state.monitor.stop()
  assert.equal(signal?.aborted, true)
  pending!(read())
  await operation
  assert.equal(state.monitor.getSnapshot().status, 'stopped')
  assert.equal(state.monitor.getSnapshot().lastCheckedAt, null)
  assert.equal(state.timers.size, 0)
})

test('read failure preserves stale evidence and exposes no private diagnostic text', async () => {
  let fail = false
  const state = setup({ read: async () => {
    if (fail) throw new Error('C:\\Users\\private\\secret-log.xml')
    const batch = read()
    batch.defenderEvents = [{ id: 'defender-1', timestamp: batch.collectedAt, eventId: 1116, detectionId: 'detection-a', threatId: '42', threatName: 'Test/Synthetic', severity: 'high', actionId: null, errorCode: '' }]
    return batch
  } })
  await state.monitor.start()
  fail = true; await state.fire()
  const snapshot = state.monitor.getSnapshot()
  assert.equal(snapshot.findings.length, 1)
  assert.equal(snapshot.stale, true)
  assert.match(snapshot.error!, /could not be read/i)
  assert.doesNotMatch(JSON.stringify(snapshot), /private|secret-log/i)
  state.monitor.dispose()
})

test('Defender detection is distinct from rule candidates and actions never prove resolution', async () => {
  const batch = read()
  batch.defenderEvents = [
    { id: 'defender-1', timestamp: '2026-10-09T11:59:00.000Z', eventId: 1116, detectionId: 'detection-a', threatId: '42', threatName: 'Test/Synthetic', severity: 'high', actionId: null, errorCode: '' },
    { id: 'defender-2', timestamp: batch.collectedAt, eventId: 1117, detectionId: 'detection-a', threatId: '42', threatName: 'Test/Synthetic', severity: 'high', actionId: 6, errorCode: '0x00000000' },
  ]
  batch.events = Array.from({ length: 5 }, (_, index) => ({ id: `evt-${index}`, timestamp: new Date(BASE - 60_000 + index * 1000).toISOString(), host: 'synthetic-host', user: 'synthetic-user', sourceIp: '192.0.2.1', channel: 'Security', eventId: 4625, process: '', commandLine: '' }))
  const state = setup({ read: async () => batch })
  const snapshot = await state.monitor.start()
  assert.equal(snapshot.findings.length, 2)
  assert.equal(snapshot.findings.find((item) => item.kind === 'defender')!.state, 'action-recorded')
  assert.equal(snapshot.findings.find((item) => item.kind === 'candidate')!.state, 'needs-review')
  assert.match(snapshot.findings.find((item) => item.kind === 'defender')!.summary, /Allow.*not.*remediat/i)
  state.monitor.dispose()
})

test('Defender correlation requires exact nonempty detection id and action no earlier than detection', async () => {
  const batch = read()
  batch.defenderEvents = [
    { id: 'defender-1', timestamp: batch.collectedAt, eventId: 1116, detectionId: '', threatId: '42', threatName: 'Test/Synthetic', severity: 'high', actionId: null, errorCode: '' },
    { id: 'defender-2', timestamp: '2026-10-09T11:59:00.000Z', eventId: 1117, detectionId: '', threatId: '42', threatName: 'Test/Synthetic', severity: 'high', actionId: 2, errorCode: '0' },
  ]
  const state = setup({ read: async () => batch })
  const snapshot = await state.monitor.start()
  assert.equal(snapshot.findings.length, 2)
  assert.equal(snapshot.findings.find((item) => item.evidenceIds.includes('defender-1'))!.state, 'needs-review')
  assert.ok(snapshot.findings.every((item) => !/resolved/i.test(item.state)))
  state.monitor.dispose()
})

test('overlapping polls deduplicate, returned snapshots are isolated, and clear removes personal records', async () => {
  const batch = read()
  batch.events = [{ id: 'evt-1', timestamp: batch.collectedAt, host: 'synthetic-host', user: 'synthetic-user', sourceIp: '', channel: 'Security', eventId: 4624, process: '', commandLine: '' }]
  const state = setup({ read: async () => batch })
  const first = await state.monitor.start()
  first.events[0].host = 'changed'
  await state.fire()
  assert.equal(state.monitor.getSnapshot().events.length, 1)
  assert.equal(state.monitor.getSnapshot().events[0].host, 'synthetic-host')
  state.monitor.clear()
  const cleared = state.monitor.getSnapshot()
  assert.equal(cleared.status, 'idle')
  assert.equal(cleared.events.length, 0)
  assert.equal(cleared.defenderEvents.length, 0)
  assert.equal(cleared.lastCheckedAt, null)
})

test('private memory retention removes expired records and count limits are disclosed', async () => {
  let first = true
  const batch = read()
  batch.events = Array.from({ length: 2001 }, (_, index) => ({ id: `evt-${index}`, timestamp: new Date(BASE - index).toISOString(), host: 'synthetic-host', user: '', sourceIp: '', channel: 'Security', eventId: 4624, process: '', commandLine: '' }))
  const state = setup({ read: async () => { if (first) { first = false; return batch } return read(BASE + ENDPOINT_RETENTION_MS + 1) } })
  let snapshot = await state.monitor.start()
  assert.equal(snapshot.events.length, 2000)
  assert.equal(snapshot.retentionLimited, true)
  state.advance(ENDPOINT_RETENTION_MS + 1); await state.fire()
  snapshot = state.monitor.getSnapshot()
  assert.equal(snapshot.events.length, 0)
  state.monitor.dispose()
})

test('idempotent start returns current state after polling, rather than the first settled snapshot', async () => {
  let first = true
  const state = setup({ read: async () => { const batch = read(); if (first) { first = false; return batch } batch.defender.realTimeProtectionEnabled = false; return batch } })
  await state.monitor.start()
  await state.fire()
  assert.equal((await state.monitor.start()).defender.realTimeProtectionEnabled, false)
  state.monitor.dispose()
})

test('stop clears all personal telemetry and a stopped generation cannot overwrite a new start', async () => {
  const pending: ((value: EndpointRead) => void)[] = []
  const state = setup({ read: async () => new Promise((resolve) => pending.push(resolve)) })
  const old = state.monitor.start({ includeSysmon: true })
  const stopped = state.monitor.stop()
  assert.equal(stopped.status, 'stopped')
  assert.deepEqual(stopped.events, [])
  assert.deepEqual(stopped.defenderEvents, [])
  assert.equal(stopped.startedAt, null)
  const current = state.monitor.start()
  const newer = read()
  newer.defender.realTimeProtectionEnabled = false
  pending[1](newer); await current
  pending[0](read()); await old
  assert.equal(state.monitor.getSnapshot().includeSysmon, false)
  assert.equal(state.monitor.getSnapshot().defender.realTimeProtectionEnabled, false)
  assert.equal(state.timers.size, 1)
  state.monitor.dispose()
})

test('cross-poll identifier collisions fail atomically instead of silently replacing evidence', async () => {
  let first = true
  const state = setup({ read: async () => {
    const batch = read()
    batch.events = [{ id: 'evt-collision', timestamp: batch.collectedAt, host: first ? 'original' : 'different', user: '', sourceIp: '', channel: 'Security', eventId: 4624, process: '', commandLine: '' }]
    first = false; return batch
  } })
  await state.monitor.start(); await state.fire()
  assert.equal(state.monitor.getSnapshot().stale, true)
  assert.equal(state.monitor.getSnapshot().events[0].host, 'original')
  state.monitor.dispose()
})

test('future records are never retained and large command-line memory is bounded and disclosed', async () => {
  const batch = read()
  batch.events = Array.from({ length: 1000 }, (_, index) => ({ id: `evt-${index}`, timestamp: new Date(BASE - index).toISOString(), host: 'synthetic-host', user: '', sourceIp: '', channel: 'Sysmon', eventId: 1, process: 'other.exe', commandLine: 'x'.repeat(8192) }))
  batch.events.push({ ...batch.events[0], id: 'future', timestamp: new Date(BASE + 1).toISOString() })
  const state = setup({ read: async () => batch })
  const snapshot = await state.monitor.start()
  assert.equal(snapshot.events.some((item) => item.id === 'future'), false)
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot.events)) <= snapshot.limits.maxRetainedBytes)
  assert.equal(snapshot.retentionLimited, true)
  assert.match(snapshot.warnings.join(' '), /byte limit/)
  state.monitor.dispose()
})

test('Defender failed actions stay actionable; unknown and nonremediating actions are not resolved', async () => {
  for (const eventId of [1117, 1118, 1119] as const) {
    const batch = read()
    batch.defenderEvents = [{ id: 'defender-action', timestamp: batch.collectedAt, eventId, detectionId: 'one', threatId: '42', threatName: 'Test/Synthetic', severity: 'unknown', actionId: 99, errorCode: '0x80508017' }]
    const state = setup({ read: async () => batch })
    const snapshot = await state.monitor.start()
    assert.equal(snapshot.findings[0].state, eventId === 1117 ? 'action-recorded' : 'action-failed')
    assert.match(snapshot.findings[0].summary, /Unknown action 99/)
    if (eventId === 1117) assert.match(snapshot.findings[0].summary, /nonzero error/)
    state.monitor.dispose()
  }
})

test('finding and Defender memory bounds disclose incomplete retained evidence', async () => {
  const batch = read()
  batch.defenderEvents = Array.from({ length: 201 }, (_, index) => ({ id: `defender-${index}`, timestamp: new Date(BASE - index).toISOString(), eventId: 1116, detectionId: `${index}`, threatId: '42', threatName: 'Test/Synthetic', severity: 'unknown', actionId: null, errorCode: '' }))
  batch.events = [{ id: 'evt-encoded', timestamp: batch.collectedAt, host: 'synthetic-host', user: '', sourceIp: '', channel: 'Sysmon', eventId: 1, process: 'powershell.exe', commandLine: 'powershell.exe -enc ZQBjAGgAbwA=' }]
  const state = setup({ read: async () => batch })
  const snapshot = await state.monitor.start()
  assert.equal(snapshot.defenderEvents.length, 200)
  assert.equal(snapshot.findings.length, 200)
  assert.equal(snapshot.retentionLimited, true)
  state.monitor.dispose()
})

test('dispose is final and invalid start options do not read or mutate state', async () => {
  let calls = 0
  const state = setup({ read: async () => { calls += 1; return read() } })
  await assert.rejects(state.monitor.start({ includeSysmon: 'true' as never }), /option/)
  state.monitor.dispose()
  await assert.rejects(state.monitor.start(), /disposed/)
  assert.equal(calls, 0)
})

test('repeated Defender detections retain latest observation and do not reuse an earlier action', async () => {
  const batch = read()
  const detection = { id: 'defender-first', timestamp: '2026-10-09T11:57:00.000Z', eventId: 1116 as const, detectionId: 'same-detection', threatId: '42', threatName: 'Test/Synthetic', severity: 'high' as const, actionId: null, errorCode: '' }
  batch.defenderEvents = [detection, { ...detection, id: 'defender-action', timestamp: '2026-10-09T11:58:00.000Z', eventId: 1117, actionId: 2 }, { ...detection, id: 'defender-latest', timestamp: '2026-10-09T11:59:00.000Z' }]
  const state = setup({ read: async () => batch })
  const snapshot = await state.monitor.start()
  const finding = snapshot.findings.find((item) => item.title.startsWith('Defender detection:'))!
  assert.equal(finding.state, 'needs-review')
  assert.equal(finding.firstSeen, detection.timestamp)
  assert.equal(finding.lastSeen, '2026-10-09T11:59:00.000Z')
  assert.deepEqual(finding.evidenceIds, ['defender-first', 'defender-latest'])
  assert.match(finding.summary, /No correlated later action/)
  state.monitor.dispose()
})

test('optional collector environment errors cannot prevent idle public app startup', async () => {
  const original = process.env.SystemRoot
  process.env.SystemRoot = 'synthetic-private-invalid-system-root'
  let monitor: ReturnType<typeof createEndpointMonitor> | undefined
  try {
    monitor = createEndpointMonitor({ platform: 'win32', now: () => BASE })
    assert.equal(monitor.getSnapshot().status, 'idle')
    const snapshot = await monitor.start()
    assert.equal(snapshot.status, 'running')
    assert.equal(snapshot.stale, true)
    assert.equal(snapshot.lastCheckedAt, null)
    assert.match(snapshot.error!, /could not be read/)
    assert.doesNotMatch(JSON.stringify(snapshot), /synthetic-private-invalid-system-root/)
  } finally {
    monitor?.dispose()
    if (original === undefined) delete process.env.SystemRoot
    else process.env.SystemRoot = original
  }
})
