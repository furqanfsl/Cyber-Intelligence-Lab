/** Local-only endpoint telemetry. This contract contains no Node/browser runtime dependency. */
export type EndpointEvent = {
  id: string
  timestamp: string
  host: string
  channel: 'Security' | 'Sysmon'
  eventId: number
  user: string
  sourceIp: string
  process: string
  commandLine: string
}

export type DefenderEvent = {
  id: string
  timestamp: string
  eventId: 1116 | 1117 | 1118 | 1119
  detectionId: string
  threatId: string
  threatName: string
  severity: 'severe' | 'high' | 'moderate' | 'low' | 'unknown'
  actionId: number | null
  errorCode: string
}

export type EndpointDefenderStatus = {
  state: 'available' | 'unavailable'
  antivirusEnabled: boolean | null
  realTimeProtectionEnabled: boolean | null
  signaturesUpdatedAt: string | null
}

export type EndpointCoverage = {
  source: 'defender' | 'security' | 'sysmon'
  state: 'available' | 'unavailable' | 'not-requested'
  eventCount: number
  truncated: boolean
  skippedCount: number
}

export type EndpointFinding = {
  id: string
  kind: 'defender' | 'candidate'
  state: 'needs-review' | 'action-recorded' | 'action-failed'
  title: string
  severity: 'high' | 'medium' | 'low'
  summary: string
  ruleId: string | null
  firstSeen: string
  lastSeen: string
  evidenceIds: string[]
  nextSteps: string[]
  falsePositives: string[]
}

export type EndpointSnapshot = {
  status: 'idle' | 'running' | 'stopped' | 'unsupported'
  platform: 'windows' | 'unsupported'
  includeSysmon: boolean
  startedAt: string | null
  lastAttemptAt: string | null
  lastCheckedAt: string | null
  nextCheckAt: string | null
  pollInProgress: boolean
  stale: boolean
  error: string | null
  defender: EndpointDefenderStatus
  coverage: EndpointCoverage[]
  defenderEvents: DefenderEvent[]
  events: EndpointEvent[]
  findings: EndpointFinding[]
  retentionLimited: boolean
  warnings: string[]
  limits: {
    pollIntervalMs: number
    queryWindowMs: number
    retentionMs: number
    maxEvents: number
    maxDefenderEvents: number
    maxFindings: number
    maxRetainedBytes: number
  }
}
