import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EndpointClientError, isEndpointLocalHostname, openEndpointSession, readEndpointStatus, startEndpointMonitor, stopEndpointMonitor, validateEndpointSnapshot } from '../../app/lib/endpoint-client.ts'

const token = 'a'.repeat(64) // Explicit local test fixture, never a real session token.
function snapshot() {
  return {
    status: 'running', platform: 'windows', includeSysmon: true, startedAt: '2026-10-09T09:00:00.000Z', lastAttemptAt: '2026-10-09T09:00:00.000Z', lastCheckedAt: '2026-10-09T09:00:00.000Z', nextCheckAt: '2026-10-09T09:00:30.000Z', pollInProgress: false, stale: false, error: null,
    defender: { state: 'available', antivirusEnabled: true, realTimeProtectionEnabled: true, signaturesUpdatedAt: '2026-10-09T08:00:00.000Z' },
    coverage: ['defender', 'security', 'sysmon'].map((source) => ({ source, state: 'available', eventCount: 1, truncated: false, skippedCount: 0 })),
    events: [{ id: 'event-1', timestamp: '2026-10-09T09:00:00.000Z', channel: 'Sysmon', eventId: 1, host: 'private-fixture', user: 'private-fixture', sourceIp: '', process: 'powershell.exe', commandLine: '-enc fixture' }],
    defenderEvents: [{ id: 'defender-1', timestamp: '2026-10-09T09:00:00.000Z', eventId: 1116, detectionId: 'fixture-detection', threatId: 'fixture-id', threatName: 'Test fixture only', severity: 'moderate', actionId: null, errorCode: '' }],
    findings: [{ id: 'finding-1', kind: 'candidate', state: 'needs-review', title: 'Test fixture', severity: 'medium', summary: 'Never real device evidence', ruleId: 'R003', firstSeen: '2026-10-09T09:00:00.000Z', lastSeen: '2026-10-09T09:00:00.000Z', evidenceIds: ['event-1'], nextSteps: ['Review original record'], falsePositives: ['Legitimate automation'] }], retentionLimited: false, warnings: [],
    limits: { pollIntervalMs: 30000, queryWindowMs: 900000, retentionMs: 3600000, maxEvents: 2000, maxDefenderEvents: 200, maxFindings: 200, maxRetainedBytes: 2097152 },
  }
}
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })

test('browser monitoring accepts only literal local hostnames, never public or LAN copies', () => {
  for (const hostname of ['127.0.0.1', 'localhost', '[::1]']) assert.equal(isEndpointLocalHostname(hostname), true)
  for (const hostname of ['', 'example.com', 'localhost.example.com', 'example.localhost', '127.0.0.1.example.com', '192.168.1.2', '0.0.0.0', '127.0.0.2', '::1', '[::ffff:127.0.0.1]', 'LOCALHOST']) assert.equal(isEndpointLocalHostname(hostname), false)
})

test('a public browser copy rejects bootstrap before making any private API request', async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { value: { location: { hostname: 'public.example' } }, configurable: true })
  t.after(() => { if (original) Object.defineProperty(globalThis, 'window', original); else Reflect.deleteProperty(globalThis, 'window') })
  const fetch = t.mock.method(globalThis, 'fetch', async () => json({ token, platform: 'windows', available: true }))
  await assert.rejects(openEndpointSession(), (error) => error.code === 'endpoint_local_only' && error.message.includes('publicly hosted website'))
  assert.equal(fetch.mock.callCount(), 0)
  Object.defineProperty(globalThis, 'window', { value: { location: { hostname: '127.0.0.1' } }, configurable: true })
  assert.equal((await openEndpointSession()).available, true)
  assert.equal(fetch.mock.callCount(), 1)
})

test('snapshot validator accepts supported evidence and nullable status without changing it', () => {
  const value = snapshot()
  assert.equal(validateEndpointSnapshot(value), value)
  value.status = 'stopped'; value.platform = 'unsupported'; value.defender.state = 'unavailable'; value.defender.antivirusEnabled = null; value.defender.realTimeProtectionEnabled = null; value.defender.signaturesUpdatedAt = null
  value.startedAt = null; value.lastAttemptAt = null; value.lastCheckedAt = null; value.nextCheckAt = null; value.error = 'A source is unavailable'
  value.coverage[0].state = 'unavailable'; value.coverage[2].state = 'not-requested'
  value.events = [{ ...value.events[0], channel: 'Security', eventId: 4625 }]; value.findings[0].kind = 'defender'; value.findings[0].state = 'action-recorded'; value.findings[0].ruleId = null; value.defenderEvents[0].actionId = 2
  assert.equal(validateEndpointSnapshot(value), value)
})

test('snapshot validator rejects malformed metadata, coverage, bounded arrays and evidence', () => {
  for (const mutate of [
    (v) => { v.status = 'safe' }, (v) => { v.platform = 'linux' }, (v) => { v.includeSysmon = 'yes' }, (v) => { v.lastCheckedAt = 'not-a-date' }, (v) => { v.lastCheckedAt = '2026-02-30T00:00:00.000Z' }, (v) => { v.lastCheckedAt = '2026-10-09T00:00:00' }, (v) => { v.lastCheckedAt = '0000-01-01T00:00:00.000Z' }, (v) => { v.error = {} }, (v) => { v.warnings = ['x'.repeat(16385)] }, (v) => { v.warnings = Array(101).fill('x') },
    (v) => { v.defender = null }, (v) => { v.defender.antivirusEnabled = 'true' }, (v) => { v.defender.state = 'healthy' }, (v) => { v.defender.state = 'unavailable' }, (v) => { v.coverage = [] }, (v) => { v.coverage[2].source = 'security' }, (v) => { v.coverage[0].eventCount = -1 }, (v) => { v.coverage[0].state = 'safe' }, (v) => { v.coverage[0].state = 'not-requested' }, (v) => { v.coverage[0].eventCount = 201 }, (v) => { v.coverage[1].skippedCount = 251 }, (v) => { v.coverage[1].eventCount = 200; v.coverage[1].skippedCount = 51 },
    (v) => { v.limits = [] }, (v) => { v.limits.maxEvents = 1000001 }, (v) => { v.limits.maxRetainedBytes = 16777217 }, (v) => { v.findings = Array(201).fill(v.findings[0]) }, (v) => { v.findings[0].kind = 'attack-proof' }, (v) => { v.findings[0].firstSeen = null }, (v) => { v.findings[0].evidenceIds = Array(21).fill('e') }, (v) => { v.findings[0].nextSteps = [{}] },
    (v) => { v.events = Array(2001).fill(v.events[0]) }, (v) => { v.events[0].eventId = 9999 }, (v) => { v.events[0].eventId = 3 }, (v) => { v.events[0].timestamp = null }, (v) => { v.events[0].host = {} }, (v) => { v.events[0].channel = 'untrusted' },
    (v) => { v.defenderEvents = Array(201).fill(v.defenderEvents[0]) }, (v) => { v.defenderEvents[0].eventId = 1001 }, (v) => { v.defenderEvents[0].severity = 'critical' }, (v) => { v.defenderEvents[0].timestamp = null }, (v) => { v.defenderEvents[0].actionId = -2 },
  ]) { const value = snapshot(); mutate(value); assert.throws(() => validateEndpointSnapshot(value), (error) => error instanceof EndpointClientError && error.code === 'endpoint_invalid_response') }
  for (const value of [null, [], 'invalid', 3]) assert.throws(() => validateEndpointSnapshot(value), EndpointClientError)
})

test('private requests stay relative, send bootstrap/token guards, and never silently scan', async (t) => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push({ url, options }); return json(url.endsWith('/session') ? { token, platform: 'windows', available: true } : snapshot()) })
  assert.deepEqual(await openEndpointSession(), { token, platform: 'windows', available: true })
  await readEndpointStatus(token); await startEndpointMonitor(token, true); await stopEndpointMonitor(token)
  assert.deepEqual(calls.map((call) => call.url), ['/api/endpoint/session', '/api/endpoint/status', '/api/endpoint/start', '/api/endpoint/stop'])
  for (const { options } of calls) { assert.equal(options.headers['X-Cyber-Lab-Endpoint-Client'], '1'); assert.equal(options.credentials, 'same-origin'); assert.equal(options.cache, 'no-store'); assert.equal(options.referrerPolicy, 'no-referrer'); assert.ok(options.signal instanceof AbortSignal) }
  assert.equal(calls[0].options.headers['X-Cyber-Lab-Endpoint-Token'], undefined)
  for (const call of calls.slice(1)) assert.equal(call.options.headers['X-Cyber-Lab-Endpoint-Token'], token)
  assert.equal(calls[1].options.method, 'GET'); assert.equal(calls[2].options.method, 'POST'); assert.equal(calls[2].options.body, '{"includeSysmon":true}'); assert.equal(calls[3].options.body, '{}')
})

test('bootstrap tolerates explicitly unavailable service and rejects unverified sessions', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => json({ token: '', platform: 'unsupported', available: false }))
  assert.equal((await openEndpointSession()).available, false)
  for (const value of [null, {}, { token: 'short', platform: 'windows', available: true }, { token: 'x'.repeat(257), platform: 'windows', available: true }, { token, platform: {}, available: true }, { token, platform: 'windows', available: 'yes' }]) {
    globalThis.fetch = async () => json(value)
    await assert.rejects(openEndpointSession(), (error) => error.code === 'endpoint_invalid_response')
  }
})

test('collector HTML, invalid or oversized JSON and arbitrary error text are never surfaced', async (t) => {
  const secret = 'PRIVATE-SERVER-ERROR-WITH-PATH'
  t.mock.method(globalThis, 'fetch', async () => new Response(`<html>${secret}</html>`, { headers: { 'Content-Type': 'text/html' } }))
  await assert.rejects(readEndpointStatus(token), (error) => error.code === 'endpoint_unavailable' && !error.message.includes(secret))
  for (const [response, code] of [
    [new Response('{bad', { headers: { 'Content-Type': 'application/json' } }), 'endpoint_invalid_response'],
    [new Response(' '.repeat(4000001), { headers: { 'Content-Type': 'application/json' } }), 'endpoint_invalid_response'],
    [json({ code: 'endpoint_local_only', message: secret }, 403), 'endpoint_local_only'],
    [json({ code: 'expired', message: secret }, 401), 'expired'],
    [json({ code: 'denied', message: secret }, 403), 'denied'],
    [json({ message: secret }, 500), 'endpoint_unavailable'],
    [json({ code: 'endpoint_failed', message: secret }, 500), 'endpoint_failed'],
  ]) { globalThis.fetch = async () => response; await assert.rejects(readEndpointStatus(token), (error) => error instanceof EndpointClientError && error.code === code && !error.message.includes(secret)) }
})

test('network failures and timed-out requests return safe, actionable errors', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('PRIVATE NETWORK DETAILS') })
  await assert.rejects(readEndpointStatus(token), (error) => error.code === 'endpoint_unavailable' && !error.message.includes('PRIVATE'))
  t.mock.timers.enable({ apis: ['setTimeout'] })
  globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('Abort private details')), { once: true }))
  const waiting = assert.rejects(startEndpointMonitor(token, false), (error) => error.code === 'endpoint_timeout')
  t.mock.timers.tick(20000)
  await waiting
})
