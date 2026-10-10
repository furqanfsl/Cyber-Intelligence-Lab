import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzeLogs, parseLogs } from '../../app/lib/log-analysis.ts'
import { suspiciousFixture, benignFixture } from '../../app/lib/log-fixtures.ts'
import { createRedactedReport, redactedMarkdown } from '../../app/lib/log-report.ts'

test('reports retain evidence references and mark synthetic provenance without raw identifiers', () => {
  const dataset = parseLogs(JSON.stringify(suspiciousFixture), 'sample.json')
  const alerts = analyzeLogs(dataset.events)
  const report = createRedactedReport(dataset, alerts, 'synthetic', { [alerts[0].id]: 'expected-activity' })
  assert.equal(report.provenance, 'Synthetic teaching fixture')
  assert.equal(report.findings.length, 3)
  assert.equal(report.findings[0].review, 'expected-activity')
  assert.equal(report.events.length, 10)
  assert.ok(report.findings.every((finding) => finding.evidenceIds.every((id) => report.events.some((event) => event.id === id))))
  const serialized = JSON.stringify(report)
  for (const event of dataset.events) {
    for (const value of [event.host, event.user, event.sourceIp, event.process, event.commandLine, event.id].filter(Boolean)) assert.ok(!serialized.includes(value), `Raw value leaked: ${value}`)
  }
  assert.ok(report.redaction.includes('UTC timestamps remain'))
})

test('allowlisted exports never copy malicious filenames, fields, titles, summaries or review values', () => {
  const secret = 'PRIVATE-SECRET-<script>alert(1)</script>|#secret'
  const dataset = parseLogs(JSON.stringify([{ timestamp: '2026-10-09T12:00:00+01:00', host: secret, channel: 'Sysmon', eventId: 1, user: secret, sourceIp: secret, process: 'powershell.exe', commandLine: `-enc ${secret}` }]), `${secret}.json`)
  const alerts = analyzeLogs(dataset.events)
  alerts[0].title = secret; alerts[0].summary = secret; alerts[0].nextSteps = [secret]; alerts[0].falsePositives = [secret]
  dataset.warnings = [secret]
  const report = createRedactedReport(dataset, alerts, 'user-import', { [alerts[0].id]: secret })
  assert.equal(report.findings[0].review, 'unreviewed')
  assert.equal(report.events[0].timestamp, '2026-10-09T11:00:00.000Z')
  assert.equal(report.events[0].processCategory, 'PowerShell')
  assert.equal(report.quality.warningCount, 1)
  assert.ok(!JSON.stringify(report).includes(secret))
  assert.ok(!redactedMarkdown(report).includes(secret))
  assert.ok(!('commandLine' in report.events[0]))
})

test('aliases consistently group identities within one report without persisting any mapping', () => {
  const dataset = parseLogs(JSON.stringify(suspiciousFixture), 'sample.json')
  const report = createRedactedReport(dataset, analyzeLogs(dataset.events), 'user-import')
  const sameHost = report.events.filter((_, index) => dataset.events[index].host === dataset.events[0].host)
  assert.ok(sameHost.every((event) => event.host === 'HOST-001'))
  assert.ok(report.events.some((event) => event.sourceIp.startsWith('ADDRESS-')))
  assert.ok(report.events.some((event) => event.processCategory === 'Not recorded'))
  const isolated = createRedactedReport({ events: [dataset.events.at(-1)], duplicateCount: 0, unsupportedCount: 0, warnings: [] }, [], 'user-import')
  assert.equal(isolated.events[0].host, 'HOST-001')
  assert.ok(report.provenance.includes('not independently verified'))
})

test('benign Markdown reports explicitly avoid a clean-bill-of-health claim and include quality counts', () => {
  const dataset = parseLogs(JSON.stringify(benignFixture), 'benign.json')
  dataset.duplicateCount = 2; dataset.unsupportedCount = 3
  const report = createRedactedReport(dataset, analyzeLogs(dataset.events), 'synthetic')
  const markdown = redactedMarkdown(report)
  assert.ok(markdown.includes('No configured rules matched. This is not a clean bill of health.'))
  assert.ok(markdown.includes('2 duplicates removed; 3 unsupported records excluded'))
  assert.ok(markdown.includes('## Evidence timeline (UTC)'))
  assert.ok(markdown.includes('## Limitations'))
  assert.ok(markdown.includes('## Redaction'))
})

test('unknown rules and evidence IDs cannot insert free text into reports', () => {
  const dataset = parseLogs(JSON.stringify(benignFixture), 'benign.json')
  const alert = { id: 'x', ruleId: '<script>unknown</script>', title: 'sensitive', severity: 'medium', summary: 'sensitive', evidenceIds: ['missing'], firstSeen: dataset.events[0].timestamp, lastSeen: dataset.events[0].timestamp, nextSteps: [], falsePositives: [] }
  const report = createRedactedReport(dataset, [alert], 'user-import')
  assert.equal(report.findings[0].ruleId, 'Unknown rule')
  assert.equal(report.findings[0].title, 'Candidate finding')
  assert.deepEqual(report.findings[0].evidenceIds, [])
  assert.ok(!JSON.stringify(report).includes('sensitive'))
  for (const ruleId of ['constructor', '__proto__', 'toString']) {
    const inherited = createRedactedReport(dataset, [{ ...alert, ruleId }], 'user-import')
    assert.equal(inherited.findings[0].ruleId, 'Unknown rule')
    assert.equal(inherited.findings[0].title, 'Candidate finding')
  }
})
