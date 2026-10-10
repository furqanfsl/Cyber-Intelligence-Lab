import type { EndpointSnapshot } from '../../shared-types/endpoint.ts'

type JsonObject = Record<string, unknown>
export type EndpointSession = { token: string; platform: string; available: boolean }
export class EndpointClientError extends Error {
  code: string
  constructor(message: string, code = 'endpoint_unavailable') { super(message); this.name = 'EndpointClientError'; this.code = code }
}
export function isEndpointLocalHostname(hostname: string): boolean {
  return ['127.0.0.1', 'localhost', '[::1]'].includes(hostname)
}

const object = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown) => typeof value === 'string' && value.length <= 16384
const date = (value: unknown) => value === null || (typeof value === 'string' && /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value)
const count = (value: unknown, maximum = 1000000) => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum
const choice = (value: unknown, choices: string[]) => typeof value === 'string' && choices.includes(value)
const strings = (value: unknown, limit = 100) => Array.isArray(value) && value.length <= limit && value.every(text)
const bool = (value: unknown) => typeof value === 'boolean'
const nullableBool = (value: unknown) => value === null || bool(value)

/** Reject malformed responses before any count, timestamp or finding reaches the UI. */
export function validateEndpointSnapshot(value: unknown): EndpointSnapshot {
  const invalid = () => { throw new EndpointClientError('The local collector returned an invalid response. Stop and restart the app before trying again.', 'endpoint_invalid_response') }
  if (!object(value) || !choice(value.status, ['idle', 'running', 'stopped', 'unsupported']) || !choice(value.platform, ['windows', 'unsupported']) ||
    !bool(value.includeSysmon) || !bool(value.pollInProgress) || !bool(value.stale) || !bool(value.retentionLimited) ||
    ![value.startedAt, value.lastAttemptAt, value.lastCheckedAt, value.nextCheckAt].every(date) || !(value.error === null || text(value.error)) || !strings(value.warnings)) return invalid()
  const defender = value.defender
  if (!object(defender) || !choice(defender.state, ['available', 'unavailable']) || !nullableBool(defender.antivirusEnabled) || !nullableBool(defender.realTimeProtectionEnabled) || !date(defender.signaturesUpdatedAt) || (defender.state === 'unavailable' && [defender.antivirusEnabled, defender.realTimeProtectionEnabled, defender.signaturesUpdatedAt].some((field) => field !== null))) return invalid()
  if (!Array.isArray(value.coverage) || value.coverage.length !== 3 || !value.coverage.every((source) => object(source) && choice(source.source, ['defender', 'security', 'sysmon']) && choice(source.state, ['available', 'unavailable', 'not-requested']) && (source.state !== 'not-requested' || source.source === 'sysmon') && count(source.eventCount, source.source === 'defender' ? 200 : 250) && count(source.skippedCount, source.source === 'defender' ? 200 : 250) && (source.eventCount as number) + (source.skippedCount as number) <= (source.source === 'defender' ? 200 : 250) && bool(source.truncated)) || new Set(value.coverage.map((source) => source.source)).size !== 3) return invalid()
  const limits = value.limits
  if (!object(limits) || !['pollIntervalMs', 'queryWindowMs', 'retentionMs'].every((key) => count(limits[key], 86400000)) || !['maxEvents', 'maxDefenderEvents', 'maxFindings'].every((key) => count(limits[key])) || limits.maxRetainedBytes !== 2097152) return invalid()
  if (!Array.isArray(value.findings) || value.findings.length > 200 || !value.findings.every((finding) => object(finding) && text(finding.id) && choice(finding.kind, ['defender', 'candidate']) && choice(finding.state, ['needs-review', 'action-recorded', 'action-failed']) && text(finding.title) && text(finding.summary) && choice(finding.severity, ['high', 'medium', 'low']) && (finding.ruleId === null || text(finding.ruleId)) && finding.firstSeen !== null && date(finding.firstSeen) && finding.lastSeen !== null && date(finding.lastSeen) && strings(finding.evidenceIds, 20) && strings(finding.nextSteps) && strings(finding.falsePositives))) return invalid()
  if (!Array.isArray(value.events) || value.events.length > 2000 || !value.events.every((event) => object(event) && [event.id, event.host, event.user, event.sourceIp, event.process, event.commandLine].every(text) && event.timestamp !== null && date(event.timestamp) && ((event.channel === 'Security' && [4624, 4625].includes(event.eventId as number)) || (event.channel === 'Sysmon' && event.eventId === 1)))) return invalid()
  if (!Array.isArray(value.defenderEvents) || value.defenderEvents.length > 200 || !value.defenderEvents.every((event) => object(event) && [event.id, event.detectionId, event.threatId, event.threatName, event.errorCode].every(text) && event.timestamp !== null && date(event.timestamp) && [1116, 1117, 1118, 1119].includes(event.eventId as number) && choice(event.severity, ['severe', 'high', 'moderate', 'low', 'unknown']) && (event.actionId === null || count(event.actionId)))) return invalid()
  return value as EndpointSnapshot
}

async function request(path: string, token: string | null, body?: JsonObject): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)
  try {
    const response = await fetch(`/api/endpoint/${path}`, {
      method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin', referrerPolicy: 'no-referrer', signal: controller.signal,
      headers: { 'X-Cyber-Lab-Endpoint-Client': '1', ...(token ? { 'X-Cyber-Lab-Endpoint-Token': token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.headers.get('content-type')?.includes('application/json')) throw new EndpointClientError('The local monitoring service is unavailable. Start this checkout with start.bat or npm run dev.', 'endpoint_unavailable')
    const raw = await response.text()
    if (raw.length > 4000000) throw new EndpointClientError('The collector response exceeded its size limit.', 'endpoint_invalid_response')
    let payload: unknown
    try { payload = JSON.parse(raw) } catch { throw new EndpointClientError('The local collector returned unreadable data.', 'endpoint_invalid_response') }
    if (!response.ok) {
      const code = object(payload) && typeof payload.code === 'string' ? payload.code : 'endpoint_unavailable'
      if (code === 'endpoint_local_only') throw new EndpointClientError('PC monitoring only works through the app running on your own PC. A publicly hosted website cannot read your device.', code)
      if (response.status === 401 || response.status === 403) throw new EndpointClientError('The local monitoring session expired or was denied. Reconnect before trying again.', code)
      throw new EndpointClientError('The local collector could not complete this request. Check the app terminal and try again.', code)
    }
    return payload
  } catch (error) {
    if (error instanceof EndpointClientError) throw error
    if (controller.signal.aborted) throw new EndpointClientError('The local collector took too long to respond. Check the app terminal before retrying.', 'endpoint_timeout')
    throw new EndpointClientError('Cannot reach the local app. Keep its terminal open and reconnect. Monitoring status is unknown.', 'endpoint_unavailable')
  } finally { clearTimeout(timeout) }
}

export async function openEndpointSession(): Promise<EndpointSession> {
  if (typeof window !== 'undefined' && !isEndpointLocalHostname(window.location.hostname)) throw new EndpointClientError('PC monitoring only works through the app running on your own PC. A publicly hosted website cannot read your device.', 'endpoint_local_only')
  const value = await request('session', null)
  if (!object(value) || typeof value.token !== 'string' || !text(value.platform) || !bool(value.available) || (value.token !== '' && !/^[a-f0-9]{64}$/.test(value.token)) || (value.available && value.token === '')) throw new EndpointClientError('The local monitoring session could not be verified.', 'endpoint_invalid_response')
  return value as EndpointSession
}
export async function readEndpointStatus(token: string) { return validateEndpointSnapshot(await request('status', token)) }
export async function startEndpointMonitor(token: string, includeSysmon: boolean) { return validateEndpointSnapshot(await request('start', token, { includeSysmon })) }
export async function stopEndpointMonitor(token: string) { return validateEndpointSnapshot(await request('stop', token, {})) }
