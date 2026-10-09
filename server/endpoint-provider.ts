import { spawn as nodeSpawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DefenderEvent, EndpointCoverage, EndpointDefenderStatus, EndpointEvent } from '../shared/endpoint.ts'
import { parseLogs } from '../src/lib/log-analysis.ts'

export type EndpointRead = {
  collectedAt: string
  defender: EndpointDefenderStatus
  coverage: EndpointCoverage[]
  defenderEvents: DefenderEvent[]
  events: EndpointEvent[]
}
export type EndpointReadRequest = { since: string; until: string; includeSysmon: boolean; signal: AbortSignal }
export type EndpointProvider = { read: (request: EndpointReadRequest) => Promise<EndpointRead> }
type ProviderOptions = {
  platform?: string
  spawn?: typeof nodeSpawn
  timeoutMs?: number
  maxBytes?: number
}
const HELPER_PATH = fileURLToPath(new URL('../scripts/read-endpoint.ps1', import.meta.url))
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const MAX_QUERY_MS = 15 * 60_000
const SOURCES = ['defender', 'security', 'sysmon'] as const

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function invalid(): never { throw new Error('Invalid endpoint telemetry response.') }
function utc(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) invalid()
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.toISOString() !== value) invalid()
  return value
}
function nullableBoolean(value: unknown): boolean | null {
  if (value !== null && typeof value !== 'boolean') invalid()
  return value
}
function boundedText(value: unknown, maxBytes: number): string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maxBytes || /\p{Cc}|[\uD800-\uDFFF]/u.test(value)) invalid()
  return value.trim()
}
function integer(value: unknown, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) invalid()
  return value
}

/** Revalidate the fixed helper's allowlist; no arbitrary XML, error text or additional properties escape. */
export function parseEndpointRead(raw: unknown): EndpointRead {
  if (!record(raw) || !record(raw.defender) || !Array.isArray(raw.coverage) || raw.coverage.length !== SOURCES.length || !Array.isArray(raw.events) || raw.events.length > 500 || !Array.isArray(raw.defenderEvents) || raw.defenderEvents.length > 200) invalid()
  const collectedAt = utc(raw.collectedAt)
  const state = raw.defender.state
  if (state !== 'available' && state !== 'unavailable') invalid()
  const defender: EndpointDefenderStatus = {
    state,
    antivirusEnabled: nullableBoolean(raw.defender.antivirusEnabled),
    realTimeProtectionEnabled: nullableBoolean(raw.defender.realTimeProtectionEnabled),
    signaturesUpdatedAt: raw.defender.signaturesUpdatedAt === null ? null : utc(raw.defender.signaturesUpdatedAt),
  }
  if (state === 'unavailable' && (defender.antivirusEnabled !== null || defender.realTimeProtectionEnabled !== null || defender.signaturesUpdatedAt !== null)) invalid()
  const seenSources = new Set<string>()
  const coverage: EndpointCoverage[] = raw.coverage.map((item: unknown) => {
    if (!record(item) || !SOURCES.includes(item.source as typeof SOURCES[number]) || seenSources.has(String(item.source)) || !['available', 'unavailable', 'not-requested'].includes(String(item.state)) || typeof item.truncated !== 'boolean') invalid()
    seenSources.add(String(item.source))
    const limit = item.source === 'defender' ? 200 : 250
    const eventCount = integer(item.eventCount, limit)
    const skippedCount = integer(item.skippedCount, limit)
    if (eventCount + skippedCount > limit || (item.truncated && eventCount + skippedCount !== limit)) invalid()
    if ((item.state !== 'available' && (eventCount !== 0 || skippedCount !== 0 || item.truncated)) || (item.source !== 'sysmon' && item.state === 'not-requested')) invalid()
    return { source: item.source as EndpointCoverage['source'], state: item.state as EndpointCoverage['state'], eventCount, skippedCount, truncated: item.truncated }
  }).sort((a, b) => SOURCES.indexOf(a.source) - SOURCES.indexOf(b.source))
  let events: EndpointEvent[] = []
  if (raw.events.length) {
    try {
      // Live collection is deliberately narrower than the separate file importer.
      if (raw.events.some((item: unknown) => !record(item) || !((item.channel === 'Security' && (item.eventId === 4624 || item.eventId === 4625)) || (item.channel === 'Sysmon' && item.eventId === 1)))) invalid()
      const dataset = parseLogs(JSON.stringify(raw.events), 'endpoint.json')
      if (dataset.unsupportedCount !== 0) invalid()
      events = dataset.events
    } catch { invalid() }
  }
  const defenderEvents: DefenderEvent[] = raw.defenderEvents.map((item: unknown) => {
    if (!record(item) || ![1116, 1117, 1118, 1119].includes(item.eventId as number) || !['severe', 'high', 'moderate', 'low', 'unknown'].includes(String(item.severity))) invalid()
    const event: Omit<DefenderEvent, 'id'> = {
      timestamp: utc(item.timestamp),
      eventId: item.eventId as DefenderEvent['eventId'],
      detectionId: boundedText(item.detectionId, 128).toLowerCase(),
      threatId: boundedText(item.threatId, 64),
      threatName: boundedText(item.threatName, 512),
      severity: item.severity as DefenderEvent['severity'],
      actionId: item.actionId === null ? null : integer(item.actionId, 2_147_483_647),
      errorCode: boundedText(item.errorCode, 32),
    }
    if (event.errorCode && !/^(?:0x[0-9a-f]{1,8}|\d{1,10})$/i.test(event.errorCode)) invalid()
    const id = `defender-${createHash('sha256').update(JSON.stringify(event)).digest('hex').slice(0, 32)}`
    return { id, ...event }
  })
  for (const source of coverage) {
    const observed = source.source === 'defender' ? raw.defenderEvents.length : raw.events.filter((item: unknown) => record(item) && (source.source === 'security' ? item.channel === 'Security' : item.channel === 'Sysmon')).length
    if (source.eventCount !== observed) invalid()
  }
  return { collectedAt, defender, coverage, defenderEvents, events }
}

/** No shell, elevation, installation, external transport, log writes, scan or remediation. */
export function createEndpointProvider(options: ProviderOptions = {}): EndpointProvider {
  const platform = options.platform ?? process.platform
  const spawn = options.spawn ?? nodeSpawn
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new Error('Invalid endpoint timeoutMs limit.')
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > DEFAULT_MAX_BYTES) throw new Error('Invalid endpoint maxBytes limit.')
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  if (platform === 'win32' && !/^[A-Za-z]:\\/.test(systemRoot)) throw new Error('Windows system path is unavailable.')
  const executable = win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return { read: async (request) => {
    if (platform !== 'win32') throw new Error('Endpoint monitoring requires local Windows.')
    try {
      utc(request.since); utc(request.until)
      const duration = Date.parse(request.until) - Date.parse(request.since)
      if (duration <= 0 || duration > MAX_QUERY_MS || typeof request.includeSysmon !== 'boolean') throw new Error()
    } catch { throw new Error('Invalid endpoint time range or option.') }
    if (request.signal.aborted) throw new Error('Endpoint read stopped.')
    const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', HELPER_PATH, '-StartTime', request.since, '-EndTime', request.until]
    if (request.includeSysmon) args.push('-IncludeSysmon')
    return new Promise<EndpointRead>((resolve, reject) => {
      let child: ReturnType<typeof nodeSpawn>
      try { child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }) }
      catch { reject(new Error('Local endpoint helper could not start.')); return }
      let completed = false
      let bytes = 0
      const chunks: Buffer[] = []
      const finish = (error: Error | null, value?: EndpointRead, terminate = false) => {
        if (completed) return
        completed = true
        clearTimeout(timer)
        request.signal.removeEventListener('abort', abort)
        if (terminate) child.kill()
        if (error) reject(error)
        else resolve(value!)
      }
      const abort = () => finish(new Error('Endpoint read stopped.'), undefined, true)
      const timer = setTimeout(() => finish(new Error('Endpoint helper exceeded its deadline.'), undefined, true), timeoutMs)
      request.signal.addEventListener('abort', abort, { once: true })
      for (const stream of [child.stdout, child.stderr]) stream?.on('data', (chunk: Buffer) => {
        if (completed) return
        bytes += chunk.byteLength
        if (bytes > maxBytes) { finish(new Error('Endpoint helper exceeded its response byte limit.'), undefined, true); return }
        if (stream === child.stdout) chunks.push(Buffer.from(chunk))
      })
      child.on('error', () => finish(new Error('Local endpoint helper could not start.'), undefined, true))
      child.on('close', (code: number | null) => {
        if (completed) return
        if (code !== 0) { finish(new Error('Local endpoint telemetry could not be read. Check Windows channel availability and your existing permissions.')); return }
        try {
          const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
          finish(null, parseEndpointRead(JSON.parse(text.replace(/^\uFEFF/, '')) as unknown))
        } catch { finish(new Error('Local endpoint helper returned an invalid telemetry response.')) }
      })
      // Abort can race the spawn operation without a signal listener yet.
      if (request.signal.aborted) abort()
    })
  } }
}
