import type { DetectionAlert, LogDataset } from './log-analysis.ts'

export type InvestigationProvenance = 'synthetic' | 'user-import'
export type ReviewDisposition = 'unreviewed' | 'needs-follow-up' | 'expected-activity'
export type InvestigationReviews = Record<string, ReviewDisposition>

const descriptions: Record<string, { title: string; explanation: string }> = {
  R001: { title: 'Repeated failed logons', explanation: 'At least five failed logons within five minutes for the same host, account and observed source address.' },
  R002: { title: 'Successful logon after repeated failures', explanation: 'A successful logon follows a qualifying failure window for the same host, account and observed source address within ten minutes.' },
  R003: { title: 'Encoded PowerShell command', explanation: 'A Sysmon process-creation record identifies PowerShell with an encoded-command flag. Legitimate automation can also match.' },
}

/** Allowlisted export: no input filename, raw identifiers, command line or free-text input. */
export function createRedactedReport(dataset: LogDataset, alerts: DetectionAlert[], provenance: InvestigationProvenance, reviews: InvestigationReviews = {}) {
  const hosts = new Map<string, string>()
  const users = new Map<string, string>()
  const addresses = new Map<string, string>()
  const ids = new Map<string, string>()
  function alias(value: string, category: string, map: Map<string, string>) {
    if (!value) return 'Not recorded'
    if (!map.has(value)) map.set(value, `${category}-${String(map.size + 1).padStart(3, '0')}`)
    return map.get(value)!
  }
  const events = dataset.events.map((event, index) => {
    const id = `EV-${String(index + 1).padStart(5, '0')}`
    ids.set(event.id, id)
    return {
      id, timestamp: event.timestamp, channel: event.channel, eventId: event.eventId,
      host: alias(event.host, 'HOST', hosts), user: alias(event.user, 'ACCOUNT', users),
      sourceIp: alias(event.sourceIp, 'ADDRESS', addresses),
      processCategory: /(?:^|[\\/])(?:powershell|pwsh)(?:\.exe)?$/i.test(event.process) ? 'PowerShell' : event.process ? 'Other process' : 'Not recorded',
    }
  })
  const findings = alerts.map((alert, index) => {
    const rule = Object.hasOwn(descriptions, alert.ruleId) ? descriptions[alert.ruleId] : undefined
    const review = reviews[alert.id]
    return {
      id: `FINDING-${String(index + 1).padStart(3, '0')}`,
      ruleId: rule ? alert.ruleId : 'Unknown rule', title: rule?.title ?? 'Candidate finding',
      explanation: rule?.explanation ?? 'Review the supporting records.',
      severity: alert.severity === 'high' ? 'high' : 'medium',
      firstSeen: alert.firstSeen, lastSeen: alert.lastSeen,
      review: review === 'expected-activity' || review === 'needs-follow-up' ? review : 'unreviewed',
      evidenceIds: alert.evidenceIds.flatMap((id) => ids.has(id) ? [ids.get(id)!] : []),
    }
  })
  return {
    schemaVersion: 1,
    title: 'Cyber Intelligence Lab — redacted investigation',
    provenance: provenance === 'synthetic' ? 'Synthetic teaching fixture' : 'User-provided export; authenticity not independently verified',
    scope: 'Read-only analysis of one imported dataset. Candidate findings are not confirmed attacks. No AI, continuous monitoring or security action.',
    redaction: 'Host, account and address values are replaced with per-report aliases. Source IDs, filenames, process paths and command lines are omitted. UTC timestamps remain. Pseudonymisation is not a guarantee of anonymity; review before sharing.',
    quality: { eventCount: events.length, candidateCount: findings.length, duplicateCount: dataset.duplicateCount, unsupportedCount: dataset.unsupportedCount, warningCount: dataset.warnings.length },
    limitations: [
      'Only Security 4624/4625 and Sysmon 1/3 records are supported; Sysmon 3 is context only.',
      'Authentication correlation requires exact host, account and observed-address values. Missing identities are excluded.',
      'Rules have fixed thresholds, are not exhaustive, and may match legitimate activity or miss attacks.',
      'Evidence contains a bounded threshold proof, not every event in a burst. Check the full timeline.',
      'No match does not establish that the system is safe. Log coverage, clock accuracy and authenticity are not verified.',
    ],
    findings, events,
  }
}

export function redactedMarkdown(report: ReturnType<typeof createRedactedReport>) {
  const lines = [
    `# ${report.title}`, '', `**Source:** ${report.provenance}`, '', report.scope, '',
    '## Observations', '', `${report.quality.eventCount} supported events; ${report.quality.candidateCount} candidate findings.`,
    `${report.quality.duplicateCount} duplicates removed; ${report.quality.unsupportedCount} unsupported records excluded; ${report.quality.warningCount} quality notices.`, '',
    '## Candidate findings', '',
  ]
  for (const finding of report.findings) {
    lines.push(`### ${finding.id}: ${finding.title}`, '',
      `Rule: ${finding.ruleId} | Severity: ${finding.severity} | Analyst review: ${finding.review}`, '',
      finding.explanation, '', `UTC window: ${finding.firstSeen} to ${finding.lastSeen}`, '',
      `Evidence: ${finding.evidenceIds.join(', ')}`, '')
  }
  if (!report.findings.length) lines.push('No configured rules matched. This is not a clean bill of health.', '')
  lines.push('## Evidence timeline (UTC)', '', '| Record | Timestamp | Channel / event | Host | Account | Observed address | Process category |', '| --- | --- | --- | --- | --- | --- | --- |')
  for (const event of report.events) {
    lines.push(`| ${event.id} | ${event.timestamp} | ${event.channel} / ${event.eventId} | ${event.host} | ${event.user} | ${event.sourceIp} | ${event.processCategory} |`)
  }
  lines.push('', '## Limitations', '', ...report.limitations.map((line) => `- ${line}`), '', '## Redaction', '', report.redaction, '')
  return lines.join('\n')
}
