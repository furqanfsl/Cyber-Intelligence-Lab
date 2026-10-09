import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { analyzeLogs, DETECTION_RULES, MAX_LOG_BYTES, parseLogs } from '../lib/log-analysis.ts'
import type { DetectionAlert, LogDataset, LogEvent } from '../lib/log-analysis.ts'
import { benignFixture, suspiciousFixture } from '../lib/log-fixtures.ts'
import { createRedactedReport, redactedMarkdown } from '../lib/log-report.ts'
import type { InvestigationProvenance, InvestigationReviews, ReviewDisposition } from '../lib/log-report.ts'
import './LogInvestigation.css'

type Investigation = { dataset: LogDataset; alerts: DetectionAlert[]; provenance: InvestigationProvenance; name: string }
const EVENT_PAGE_SIZE = 50
const ALERT_PAGE_SIZE = 20
const reviewLabels: Record<ReviewDisposition, string> = {
  unreviewed: 'Unreviewed', 'needs-follow-up': 'Needs follow-up', 'expected-activity': 'Expected activity',
}

function eventLabel(event: LogEvent) {
  if (event.channel === 'Security') return event.eventId === 4625 ? 'Failed logon' : 'Successful logon'
  return event.eventId === 1 ? 'Process created' : 'Network connection (context only)'
}

function utc(value: string) { return value.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC') }

function download(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  // Allow the browser to consume the Blob before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function LogInvestigation() {
  const [investigation, setInvestigation] = useState<Investigation | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [announcement, setAnnouncement] = useState('No local dataset loaded.')
  const [severity, setSeverity] = useState<'all' | 'high' | 'medium'>('all')
  const [selectedId, setSelectedId] = useState('')
  const [query, setQuery] = useState('')
  const [eventPage, setEventPage] = useState(0)
  const [alertPage, setAlertPage] = useState(0)
  const [reviews, setReviews] = useState<InvestigationReviews>({})
  const generation = useRef(0)
  useEffect(() => () => { generation.current += 1 }, [])

  const filteredAlerts = useMemo(() => investigation?.alerts.filter((alert) => severity === 'all' || alert.severity === severity) ?? [], [investigation, severity])
  const alertPages = Math.max(1, Math.ceil(filteredAlerts.length / ALERT_PAGE_SIZE))
  const currentAlertPage = Math.min(alertPage, alertPages - 1)
  const visibleAlerts = filteredAlerts.slice(currentAlertPage * ALERT_PAGE_SIZE, (currentAlertPage + 1) * ALERT_PAGE_SIZE)
  const selected = visibleAlerts.find((alert) => alert.id === selectedId) ?? visibleAlerts[0]
  const events = useMemo(() => {
    const term = query.trim().toLowerCase()
    return investigation?.dataset.events.filter((event) => !term || [event.host, event.user, event.sourceIp, event.process, event.channel, String(event.eventId), eventLabel(event)].some((value) => value.toLowerCase().includes(term))) ?? []
  }, [investigation, query])
  const pages = Math.max(1, Math.ceil(events.length / EVENT_PAGE_SIZE))
  const currentEventPage = Math.min(eventPage, pages - 1)
  const evidenceIds = new Set(selected?.evidenceIds)
  const evidence = investigation?.dataset.events.filter((event) => evidenceIds.has(event.id)) ?? []

  function commit(dataset: LogDataset, provenance: InvestigationProvenance, name: string) {
    const alerts = analyzeLogs(dataset.events)
    setInvestigation({ dataset, alerts, provenance, name })
    setSelectedId(alerts[0]?.id ?? '')
    setQuery(''); setSeverity('all'); setEventPage(0); setAlertPage(0); setReviews({}); setError('')
    setAnnouncement(`${provenance === 'synthetic' ? 'Synthetic sample' : 'User-provided export'} loaded: ${dataset.events.length} supported events, ${alerts.length} candidate findings. No file was uploaded.`)
  }

  function loadSample(kind: 'suspicious' | 'benign') {
    generation.current += 1
    try {
      commit(parseLogs(JSON.stringify(kind === 'suspicious' ? suspiciousFixture : benignFixture), 'sample.json'), 'synthetic', `${kind === 'suspicious' ? 'Suspicious' : 'Benign'} teaching sample`)
    } catch { setError('The teaching sample could not be loaded. Reload the lab and try again.') }
    setBusy(false)
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const token = ++generation.current
    setBusy(true); setError(''); setAnnouncement('Reading and validating the file locally…')
    try {
      if (file.size > MAX_LOG_BYTES) throw new Error('File exceeds the 5 MiB limit. Export a shorter observation window and try again.')
      const bytes = await file.arrayBuffer()
      if (token !== generation.current) return
      let text: string
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
      catch { throw new Error('File is not valid UTF-8. Export the records as UTF-8 and try again.') }
      // Give the reading state a paint before bounded local parsing.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      if (token !== generation.current) return
      const dataset = parseLogs(text, file.name)
      commit(dataset, 'user-import', file.name)
    } catch (failure) {
      if (token !== generation.current) return
      setError(`${failure instanceof Error ? failure.message : 'File could not be read.'} ${investigation ? 'Your previous dataset has not changed.' : 'No local dataset was loaded.'}`)
      setAnnouncement('Import failed. Choose a supported export and try again.')
    } finally { if (token === generation.current) setBusy(false) }
  }

  function clear() {
    generation.current += 1
    setInvestigation(null); setBusy(false); setError(''); setSelectedId(''); setQuery(''); setReviews({}); setEventPage(0); setAlertPage(0); setSeverity('all')
    setAnnouncement('Local dataset cleared from this view. Any files you downloaded remain on your computer.')
  }

  function exportReport(format: 'markdown' | 'json') {
    if (!investigation) return
    try {
      const report = createRedactedReport(investigation.dataset, investigation.alerts, investigation.provenance, reviews)
      download(format === 'json' ? JSON.stringify(report, null, 2) : redactedMarkdown(report), `cyber-lab-redacted-investigation.${format === 'json' ? 'json' : 'md'}`, format === 'json' ? 'application/json' : 'text/markdown;charset=utf-8')
      setAnnouncement('Redacted report prepared for download. Timestamps remain; review the file before sharing.')
    } catch { setError('The report could not be downloaded. Your dataset is unchanged; try again.') }
  }

  return (
    <section id="investigation" className="investigation-section" aria-labelledby="investigation-heading">
      <header className="investigation-heading">
        <div><p className="kicker">Local evidence / no paid AI</p><h2 id="investigation-heading">Investigate your own logs.</h2><p>Import an authorized export. Follow the evidence. Decide what needs a closer look.</p></div>
        <span className="investigation-local-label">Processed in this browser<br /><strong>No log upload · no AI tokens</strong></span>
      </header>

      <div className="investigation-import" aria-busy={busy}>
        <div className="investigation-file-field">
          <label htmlFor="investigation-file">Import log file</label>
          <input id="investigation-file" type="file" accept=".json,.jsonl,.ndjson,.csv,.xml" onChange={(event) => void importFile(event)} disabled={busy} aria-describedby="investigation-file-help" />
          <p id="investigation-file-help">UTF-8 JSON, NDJSON, CSV or Windows event XML · up to 5 MiB / 10,000 records. Binary .evtx is not supported.</p>
        </div>
        <div className="investigation-samples">
          <span>Try a clearly labelled teaching dataset</span>
          <div><button type="button" disabled={busy} onClick={() => loadSample('suspicious')}>Load suspicious sample</button><button type="button" disabled={busy} onClick={() => loadSample('benign')}>Load benign sample</button></div>
        </div>
      </div>
      <p className="investigation-privacy">Only import records you are allowed to analyse. Logs stay in this tab’s memory—not the server or browser storage. Clear or reload to discard the view. Your original file is unchanged.</p>
      <div className="investigation-status" role="status" aria-live="polite">{announcement}</div>
      {error && <p className="investigation-error" role="alert">{error}</p>}

      {!investigation ? <div className="investigation-empty">
        <span className="investigation-empty-mark" aria-hidden="true">Start here</span>
        <div><h3>Start with the suspicious sample.</h3><p>Review three transparent rule matches, inspect the records behind them, then compare with the benign sample. Nothing here runs commands or changes your system.</p></div>
      </div> : <>
        <div className="investigation-dataset">
          <div><span className={investigation.provenance === 'synthetic' ? 'investigation-provenance synthetic' : 'investigation-provenance'}>{investigation.provenance === 'synthetic' ? 'Synthetic sample' : 'User-provided export · not independently verified'}</span><h3>{investigation.name}</h3></div>
          <button type="button" onClick={clear}>Clear local dataset</button>
        </div>
        <dl className="investigation-metrics">
          <div><dt>Supported events</dt><dd>{investigation.dataset.events.length.toLocaleString()}</dd></div>
          <div><dt>Candidate findings</dt><dd>{investigation.alerts.length.toLocaleString()}</dd></div>
          <div><dt>Duplicates removed</dt><dd>{investigation.dataset.duplicateCount.toLocaleString()}</dd></div>
          <div><dt>Unsupported records</dt><dd>{investigation.dataset.unsupportedCount.toLocaleString()}</dd></div>
        </dl>
        {investigation.dataset.warnings.length > 0 && <details className="investigation-quality"><summary>Data quality notices ({investigation.dataset.warnings.length})</summary><ul>{investigation.dataset.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}

        <div className="investigation-workspace">
          <div className="investigation-candidates">
            <h3>Candidate findings</h3>
            <p>Rules flag patterns, not confirmed attacks.</p>
            <div className="investigation-severity" role="group" aria-label="Candidate severity">{(['all', 'high', 'medium'] as const).map((value) => <button type="button" key={value} aria-pressed={severity === value} onClick={() => { setSeverity(value); setAlertPage(0) }}>{value === 'all' ? 'All' : value === 'high' ? 'High' : 'Medium'} <span>{investigation.alerts.filter((alert) => value === 'all' || value === alert.severity).length}</span></button>)}</div>
            {visibleAlerts.length ? <div className="investigation-alert-list">{visibleAlerts.map((alert) => <button type="button" className="investigation-alert-row" key={alert.id} data-rule-id={alert.ruleId} aria-pressed={selected?.id === alert.id} onClick={() => setSelectedId(alert.id)}>
              <span><code>{alert.ruleId}</code><span className={`investigation-severity-label ${alert.severity}`}>{alert.severity}</span></span><strong>{alert.title}</strong><small>{utc(alert.firstSeen)}</small><small>{reviewLabels[reviews[alert.id] ?? 'unreviewed']} · {alert.evidenceIds.length} supporting records</small>
            </button>)}</div> : <p className="investigation-no-match">{investigation.alerts.length ? 'No findings at this severity. Choose All to restore the list.' : 'No configured rules matched. This does not establish that the system is safe.'}</p>}
            {alertPages > 1 && <Pagination label="Candidate pages" page={currentAlertPage} pages={alertPages} onPage={setAlertPage} />}
          </div>

          <article className="investigation-detail" aria-label="Candidate evidence">
            {selected ? <>
              <p className="investigation-eyebrow">{selected.ruleId} / evidence-backed candidate</p><h3>{selected.title}</h3><p>{selected.summary}</p>
              <div className="investigation-review"><label htmlFor="investigation-review">Analyst review</label><select id="investigation-review" value={reviews[selected.id] ?? 'unreviewed'} onChange={(event) => { const value = event.target.value as ReviewDisposition; setReviews((current) => ({ ...current, [selected.id]: value })); setAnnouncement(`Candidate review updated: ${reviewLabels[value]}. This is your assessment, not an automated verdict.`) }}>{Object.entries(reviewLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
              <h4>Supporting timeline <span>UTC</span></h4><p className="investigation-evidence-note">Bounded proof of the rule match; the searchable event table below contains the full supported dataset.</p>
              <ol className="investigation-evidence">{evidence.map((event) => <li className="investigation-evidence-row" data-event-id={event.id} key={event.id}><time dateTime={event.timestamp}>{utc(event.timestamp)}</time><strong>{eventLabel(event)} <code>{event.channel} / {event.eventId}</code></strong><span>{event.host} · {event.user || 'Account not recorded'} · {event.sourceIp || 'Address not recorded'}</span>{event.process && <span className="investigation-process">{event.process}</span>}{event.commandLine && <details><summary>Inspect recorded command line (untrusted text)</summary><pre>{event.commandLine}</pre><p>No command is executed or decoded.</p></details>}</li>)}</ol>
              <div className="investigation-guidance"><div><h4>Suggested checks</h4><ul>{selected.nextSteps.map((step) => <li key={step}>{step}</li>)}</ul></div><div><h4>Possible benign explanations</h4><ul>{selected.falsePositives.map((item) => <li key={item}>{item}</li>)}</ul></div></div>
            </> : <><h3>Review the observation window.</h3><p>Search the imported records below. A short, incomplete or unsupported export can produce no findings even when suspicious activity occurred.</p></>}
          </article>
        </div>

        <div className="investigation-events">
          <div className="investigation-event-header"><div><h3>Imported event timeline</h3><p>Normalized records · chronological order · UTC</p></div><div className="investigation-search"><label htmlFor="investigation-search">Search imported logs</label><input id="investigation-search" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setEventPage(0) }} placeholder="Host, account, address, process or event ID" /></div></div>
          <p className="investigation-event-count">{events.length} matching events{events.length > EVENT_PAGE_SIZE ? ` · showing ${currentEventPage * EVENT_PAGE_SIZE + 1}–${Math.min((currentEventPage + 1) * EVENT_PAGE_SIZE, events.length)}` : ''}<span className="investigation-table-hint">On narrow screens, scroll the table sideways for all fields.</span></p>
          {events.length ? <div className="investigation-table-region" tabIndex={0} role="region" aria-label="Imported event table, scroll horizontally on narrow screens"><table><caption className="sr-only">Imported events. Values are untrusted records, not verified identities.</caption><thead><tr><th scope="col">Timestamp (UTC)</th><th scope="col">Event</th><th scope="col">Host / account</th><th scope="col">Observed address</th><th scope="col">Process</th></tr></thead><tbody>{events.slice(currentEventPage * EVENT_PAGE_SIZE, (currentEventPage + 1) * EVENT_PAGE_SIZE).map((event) => <tr className="investigation-event-row" key={event.id} data-event-id={event.id}><td><time dateTime={event.timestamp}>{utc(event.timestamp)}</time></td><td><strong>{eventLabel(event)}</strong><code>{event.channel} / {event.eventId}</code></td><td><span>{event.host}</span><span>{event.user || 'Not recorded'}</span></td><td>{event.sourceIp || 'Not recorded'}</td><td>{event.process || 'Not recorded'}</td></tr>)}</tbody></table></div> : <p className="investigation-no-match">No matching supported events. Clear the search or import a supported observation window.</p>}
          {pages > 1 && <Pagination label="Event pages" page={currentEventPage} pages={pages} onPage={setEventPage} />}
        </div>

        <div className="investigation-export"><div><h3>Share the findings, not the raw identifiers.</h3><p>Reports replace host, account and address values with aliases and omit command lines, process paths and filenames. Timestamps remain. Review before sharing.</p></div><div><button type="button" onClick={() => exportReport('markdown')}>Export redacted Markdown</button><button type="button" onClick={() => exportReport('json')}>Export redacted JSON</button></div></div>
      </>}

      <details className="investigation-rules"><summary>Detection rules &amp; limitations</summary><div>{DETECTION_RULES.map((rule) => <article key={rule.id}><code>{rule.id}</code><h3>{rule.title}</h3><p>{rule.description}</p><ul>{rule.limitations.map((limit) => <li key={limit}>{limit}</li>)}</ul></article>)}</div><p>Exact identifiers and event timestamps drive correlation. These three fixed rules do not cover every attack. Public advisories are context—not evidence of activity on your machine. No continuous collector, AI, attribution or containment is connected.</p></details>
      <details className="investigation-format"><summary>Exporting Windows logs &amp; saving an investigation</summary><p>The repository’s <code>scripts/export-windows-logs.ps1</code> exports a bounded window of Security logons and, when already installed, optional Sysmon records. You must run it yourself with permission to read those logs. It does not install a sensor or change audit settings.</p><p>For persistent local storage, the optional Python tool in <code>tools/loglab</code> normalizes records into SQLite and produces redacted reports. The website uses tab memory only; it does not save to that database. See <code>docs/log-investigation.md</code> in the repository for commands, supported formats and SQL investigation queries.</p><button type="button" onClick={() => download(JSON.stringify(suspiciousFixture, null, 2), 'cyber-lab-synthetic-sample.json', 'application/json')}>Download synthetic sample JSON</button></details>
    </section>
  )
}

function Pagination({ label, page, pages, onPage }: { label: string; page: number; pages: number; onPage: (page: number) => void }) {
  return <nav className="investigation-pagination" aria-label={label}><button type="button" disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</button><span>Page {page + 1} of {pages}</span><button type="button" disabled={page + 1 === pages} onClick={() => onPage(page + 1)}>Next</button></nav>
}
