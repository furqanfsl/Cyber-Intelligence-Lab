import { createHash } from 'node:crypto'
import type { DefenderEvent, EndpointFinding, EndpointSnapshot } from '../shared-types/endpoint.ts'
import { analyzeLogs } from '../app/lib/log-analysis.ts'
import { createEndpointProvider, type EndpointProvider } from './endpoint-provider.ts'

export const ENDPOINT_POLL_MS = 30_000
export const ENDPOINT_QUERY_MS = 15 * 60_000
export const ENDPOINT_RETENTION_MS = 60 * 60_000
const MAX_EVENTS = 2_000
const MAX_DEFENDER_EVENTS = 200
const MAX_FINDINGS = 200
const MAX_RETAINED_BYTES = 2 * 1024 * 1024
type Timer = ReturnType<typeof setTimeout> | number
type MonitorOptions = {
  provider?: EndpointProvider
  platform?: string
  now?: () => number
  setTimeout?: (callback: () => void, delay: number) => Timer
  clearTimeout?: (timer: Timer) => void
}

const ACTIONS: Readonly<Record<number, string>> = Object.freeze({ 0: 'Unknown', 1: 'Clean', 2: 'Quarantine', 3: 'Remove', 6: 'Allow', 8: 'User-defined', 9: 'No action', 10: 'Block' })
function severity(event: DefenderEvent): EndpointFinding['severity'] {
  return event.severity === 'severe' || event.severity === 'high' ? 'high' : event.severity === 'low' ? 'low' : 'medium'
}
function eventOrder(a: { timestamp: string; id: string }, b: { timestamp: string; id: string }) {
  return Date.parse(a.timestamp) - Date.parse(b.timestamp) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}
function actionSummary(event: DefenderEvent): string {
  const action = event.actionId === null ? 'Unspecified' : Object.hasOwn(ACTIONS, event.actionId) ? ACTIONS[event.actionId] : `Unknown action ${event.actionId}`
  if (event.eventId === 1118 || event.eventId === 1119) return `Microsoft Defender reported a failed ${action} action (event ${event.eventId}). Review Protection history; this monitor did not change or remediate anything.`
  const noRemediation = event.actionId === 6 || event.actionId === 9 || event.actionId === 0 || event.actionId === null
  const error = event.errorCode && !/^(?:0+|0x0+)$/i.test(event.errorCode)
  return `Microsoft Defender reported ${action} (event 1117). ${noRemediation ? `${action} is not evidence of remediation. ` : ''}${error ? 'A nonzero error code was recorded. ' : ''}An action record does not establish that this computer is clean or the finding is resolved. Verify the outcome in Windows Security > Protection history.`
}

/** Exact, nonempty Detection ID correlation only. An action never means "resolved". */
function defenderFindings(events: DefenderEvent[]): EndpointFinding[] {
  const sorted = [...events].sort(eventOrder)
  const used = new Set<string>()
  const result: EndpointFinding[] = []
  const detections = new Map<string, DefenderEvent[]>()
  for (const event of sorted.filter((item) => item.eventId === 1116)) {
    const key = event.detectionId ? `detection:${event.detectionId}` : `event:${event.id}`
    const group = detections.get(key) ?? []
    group.push(event); detections.set(key, group)
  }
  function append(proof: DefenderEvent[], detected: boolean) {
    const first = proof[0]
    const last = proof[proof.length - 1]
    const failed = last.eventId === 1118 || last.eventId === 1119
    const action = last.eventId === 1117
    const title = detected ? `Defender detection: ${first.threatName || 'Name not recorded'}` : failed ? 'Defender action failed' : 'Defender action record'
    const summary = detected
      ? `Microsoft Defender recorded malware or potentially unwanted software (event 1116). ${last.eventId === 1116 ? 'No correlated later action is visible in the retained records. Review Protection history; the current threat state is not inferred from this event.' : actionSummary(last)}`
      : actionSummary(last)
    result.push({
      id: `endpoint-${createHash('sha256').update(detected ? first.detectionId || first.id : first.id).digest('hex').slice(0, 32)}`,
      kind: 'defender', state: failed ? 'action-failed' : action ? 'action-recorded' : 'needs-review', title,
      severity: failed ? 'high' : severity(first), summary, ruleId: null,
      firstSeen: first.timestamp, lastSeen: last.timestamp, evidenceIds: proof.map((item) => item.id),
      nextSteps: [
        'Open Windows Security, then Virus & threat protection > Protection history, and review the matching detection and its current outcome.',
        'Use the actions offered by Windows Security or your organization’s approved response process. Do not allow an unknown threat or run a suspicious file.',
        'Confirm follow-up evidence before marking your own investigation complete. This dashboard never quarantines, deletes, scans or changes settings.',
      ],
      falsePositives: ['A Defender classification can require context or vendor review. This record can be historical, already handled, or relate to potentially unwanted software rather than a proven compromise.'],
    })
    proof.forEach((item) => used.add(item.id))
  }
  for (const group of detections.values()) {
    const first = group[0]
    const latestDetection = group[group.length - 1]
    const matches = first.detectionId ? sorted.filter((item) => item.eventId !== 1116 && item.detectionId === first.detectionId && Date.parse(item.timestamp) >= Date.parse(latestDetection.timestamp)) : []
    const lastAction = matches.at(-1)
    const proof = first.id === latestDetection.id ? [first] : [first, latestDetection]
    if (lastAction) proof.push(lastAction)
    append(proof, true)
    group.forEach((item) => used.add(item.id))
    matches.forEach((item) => used.add(item.id))
  }
  for (const event of sorted) if (!used.has(event.id)) append([event], false)
  return result
}

export function createEndpointMonitor(options: MonitorOptions = {}) {
  const platform = options.platform ?? process.platform
  // Optional collection must not prevent the public dashboard from starting.
  // Instantiate the OS provider only inside an explicit poll's guarded path.
  let provider = options.provider
  const now = options.now ?? Date.now
  const schedule = options.setTimeout ?? setTimeout
  const cancel = options.clearTimeout ?? ((timer: Timer) => clearTimeout(timer))
  let generation = 0
  let disposed = false
  let timer: Timer | null = null
  let abort: AbortController | null = null
  let flight: Promise<EndpointSnapshot> | null = null
  function initial(status: EndpointSnapshot['status'] = platform === 'win32' ? 'idle' : 'unsupported'): EndpointSnapshot {
    return {
      status, platform: platform === 'win32' ? 'windows' : 'unsupported', includeSysmon: false,
      startedAt: null, lastAttemptAt: null, lastCheckedAt: null, nextCheckAt: null, pollInProgress: false, stale: false, error: null,
      defender: { state: 'unavailable', antivirusEnabled: null, realTimeProtectionEnabled: null, signaturesUpdatedAt: null },
      coverage: [
        { source: 'defender', state: 'unavailable', eventCount: 0, truncated: false, skippedCount: 0 },
        { source: 'security', state: 'unavailable', eventCount: 0, truncated: false, skippedCount: 0 },
        { source: 'sysmon', state: 'not-requested', eventCount: 0, truncated: false, skippedCount: 0 },
      ],
      events: [], defenderEvents: [], findings: [], retentionLimited: false, warnings: [],
      limits: { pollIntervalMs: ENDPOINT_POLL_MS, queryWindowMs: ENDPOINT_QUERY_MS, retentionMs: ENDPOINT_RETENTION_MS, maxEvents: MAX_EVENTS, maxDefenderEvents: MAX_DEFENDER_EVENTS, maxFindings: MAX_FINDINGS, maxRetainedBytes: MAX_RETAINED_BYTES },
    }
  }
  let snapshot = initial()
  const clone = () => structuredClone(snapshot)
  function updateFindings() {
    const candidates: EndpointFinding[] = analyzeLogs(snapshot.events).map((item) => ({ ...item, kind: 'candidate', state: 'needs-review', ruleId: item.ruleId }))
    const all = [...defenderFindings(snapshot.defenderEvents), ...candidates].sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen) || a.id.localeCompare(b.id))
    if (all.length > MAX_FINDINGS) snapshot.retentionLimited = true
    snapshot.findings = all.slice(0, MAX_FINDINGS)
    snapshot.warnings = [
      'This is a limited read-only view of existing Windows telemetry, not a full endpoint protection or managed security service.',
      'No findings is not proof that the computer is safe. Historical records are not a reliable statement of a threat’s current state.',
      ...(snapshot.coverage.some((source) => source.state === 'unavailable') ? ['Some existing Windows telemetry could not be read. Nothing was installed, enabled or elevated.'] : []),
      ...(snapshot.coverage.some((source) => source.truncated || source.skippedCount) ? ['A query reached its per-channel bound or records could not be normalized. This window has incomplete coverage.'] : []),
      ...(snapshot.retentionLimited ? ['The private in-memory count or byte limit was reached. Older evidence or additional findings are not retained.'] : []),
    ]
  }
  function trimMemory() {
    const cutoff = now() - ENDPOINT_RETENTION_MS
    snapshot.events = snapshot.events.filter((item) => Date.parse(item.timestamp) >= cutoff && Date.parse(item.timestamp) <= now()).sort(eventOrder)
    snapshot.defenderEvents = snapshot.defenderEvents.filter((item) => Date.parse(item.timestamp) >= cutoff && Date.parse(item.timestamp) <= now()).sort(eventOrder)
    if (snapshot.events.length > MAX_EVENTS || snapshot.defenderEvents.length > MAX_DEFENDER_EVENTS) snapshot.retentionLimited = true
    snapshot.events = snapshot.events.slice(-MAX_EVENTS)
    snapshot.defenderEvents = snapshot.defenderEvents.slice(-MAX_DEFENDER_EVENTS)
    let bytes = snapshot.events.reduce((total, item) => total + Buffer.byteLength(JSON.stringify(item)), 0) + snapshot.defenderEvents.reduce((total, item) => total + Buffer.byteLength(JSON.stringify(item)), 0)
    let removed = 0
    while (bytes > MAX_RETAINED_BYTES && removed < snapshot.events.length) {
      bytes -= Buffer.byteLength(JSON.stringify(snapshot.events[removed])); removed += 1
    }
    if (removed) { snapshot.retentionLimited = true; snapshot.events = snapshot.events.slice(removed) }
    updateFindings()
  }
  async function poll(current: number): Promise<EndpointSnapshot> {
    const time = now()
    const controller = new AbortController()
    abort = controller
    snapshot.pollInProgress = true
    snapshot.nextCheckAt = null
    snapshot.lastAttemptAt = new Date(time).toISOString()
    try {
      provider ??= createEndpointProvider({ platform })
      const read = await provider.read({ since: new Date(time - ENDPOINT_QUERY_MS).toISOString(), until: new Date(time).toISOString(), includeSysmon: snapshot.includeSysmon, signal: controller.signal })
      if (current !== generation || disposed || snapshot.status !== 'running') return clone()
      function merge<T extends { id: string }>(retained: T[], incoming: T[]): T[] {
        const values = new Map(retained.map((item) => [item.id, item]))
        for (const item of incoming) {
          if (values.has(item.id) && JSON.stringify(values.get(item.id)) !== JSON.stringify(item)) throw new Error('Endpoint event identifier collision.')
          values.set(item.id, item)
        }
        return [...values.values()]
      }
      const events = merge(snapshot.events, read.events)
      const defenderEvents = merge(snapshot.defenderEvents, read.defenderEvents)
      snapshot.lastCheckedAt = read.collectedAt
      snapshot.defender = structuredClone(read.defender)
      snapshot.coverage = structuredClone(read.coverage)
      snapshot.stale = false
      snapshot.error = null
      snapshot.events = structuredClone(events)
      snapshot.defenderEvents = structuredClone(defenderEvents)
      trimMemory()
    } catch {
      if (current !== generation || disposed || snapshot.status !== 'running') return clone()
      snapshot.stale = true
      snapshot.error = 'Local Windows telemetry could not be read. Check existing channel availability and your permissions; no settings were changed.'
      trimMemory()
    } finally {
      if (current === generation && !disposed && snapshot.status === 'running') {
        abort = null
        flight = null
        snapshot.pollInProgress = false
        snapshot.nextCheckAt = new Date(now() + ENDPOINT_POLL_MS).toISOString()
        timer = schedule(() => { timer = null; flight = poll(current) }, ENDPOINT_POLL_MS)
        if (typeof timer === 'object' && 'unref' in timer) timer.unref()
      }
    }
    return clone()
  }
  function release() {
    generation += 1
    if (timer !== null) { cancel(timer); timer = null }
    abort?.abort(); abort = null; flight = null
  }
  return {
    start: async (request: { includeSysmon?: boolean } = {}): Promise<EndpointSnapshot> => {
      if (disposed) throw new Error('Endpoint monitor is disposed.')
      if (request.includeSysmon !== undefined && typeof request.includeSysmon !== 'boolean') throw new Error('Invalid endpoint monitoring option.')
      if (platform !== 'win32') return clone()
      if (snapshot.status === 'running') return flight ? await flight : clone()
      snapshot = initial('running')
      snapshot.includeSysmon = request.includeSysmon === true
      snapshot.startedAt = new Date(now()).toISOString()
      const current = ++generation
      flight = poll(current)
      return await flight
    },
    stop: (): EndpointSnapshot => { release(); snapshot = initial(platform === 'win32' ? 'stopped' : 'unsupported'); return clone() },
    clear: (): EndpointSnapshot => { release(); snapshot = initial(); return clone() },
    getSnapshot: (): EndpointSnapshot => {
      if (snapshot.status === 'running') trimMemory()
      return clone()
    },
    dispose: () => { release(); snapshot = initial(); disposed = true },
  }
}

export type EndpointMonitor = ReturnType<typeof createEndpointMonitor>
