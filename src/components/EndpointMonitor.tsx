import { useEffect, useMemo, useRef, useState } from 'react'
import type { DefenderEvent, EndpointCoverage, EndpointEvent, EndpointFinding, EndpointSnapshot } from '../../shared/endpoint.ts'
import { EndpointClientError, openEndpointSession, readEndpointStatus, startEndpointMonitor, stopEndpointMonitor } from '../lib/endpoint-client.ts'
import './EndpointMonitor.css'

type Review = 'unreviewed' | 'follow-up' | 'expected-activity'
type Filter = 'all' | 'defender' | 'candidate'
const PAGE_SIZE = 10
const sourceNames = { defender: 'Microsoft Defender', security: 'Windows Security log', sysmon: 'Sysmon process log' }
const outcomeNames = { 'needs-review': 'Needs review', 'action-recorded': 'Defender action recorded', 'action-failed': 'Defender action failed' }
function utc(value: string) { return value.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC') }
function defenderEventName(eventId: number) { return eventId === 1116 ? 'Threat detected by Defender' : eventId === 1117 ? 'Defender action recorded' : 'Defender action failed' }
function eventName(event: EndpointEvent) { return event.channel === 'Security' ? event.eventId === 4625 ? 'Failed logon' : 'Successful logon' : event.eventId === 1 ? 'Process created' : 'Network connection (context only)' }
function errorMessage(error: unknown) { return error instanceof EndpointClientError ? error.message : 'The local monitoring request failed. Check the app terminal and reconnect.' }

function Coverage({ source, checked }: { source: EndpointCoverage; checked: boolean }) {
  const state = !checked && source.state !== 'not-requested' ? 'Not checked yet' : source.state === 'available' ? 'Available at the last check' : source.state === 'not-requested' ? 'Not requested' : 'Unavailable or permission denied'
  return <li>
    <h4>{sourceNames[source.source]}</h4>
    <p className="endpoint-source-state" data-status={checked ? source.state : 'unchecked'}>{state}</p>
    {checked && source.state === 'available' && <small>{source.eventCount} {source.eventCount === 1 ? 'record' : 'records'} returned by the last bounded query{source.truncated ? ' · Source query reached its limit' : ''}{source.skippedCount > 0 ? ` · ${source.skippedCount} unsupported or invalid records skipped` : ''}</small>}
    {source.state === 'unavailable' && checked && <small>{source.source === 'security' ? 'This log may need permission and enabled auditing. The app does not request elevation or change auditing.' : source.source === 'sysmon' ? 'Requires an existing, readable Sysmon installation and its configured events. The app does not install it.' : 'Defender may be unavailable, managed by policy, or replaced by another antivirus. Check Windows Security.'}</small>}
    {source.source === 'sysmon' && source.state === 'not-requested' && <small>Optional existing Sysmon log. Enable it before starting if you have permission.</small>}
  </li>
}

function Evidence({ finding, snapshot }: { finding: EndpointFinding; snapshot: EndpointSnapshot }) {
  const ids = new Set(finding.evidenceIds)
  const evidence = [...snapshot.events, ...snapshot.defenderEvents].filter((event) => ids.has(event.id)).sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  return <>
    <h4>Evidence timeline · UTC</h4>
    {evidence.length === 0 ? <p className="endpoint-empty">The supporting records are no longer retained. Review the finding in Windows Security or the original event log.</p> : <ol className="endpoint-evidence">
      {evidence.map((event) => 'channel' in event ? <li key={event.id}>
        <time dateTime={event.timestamp}>{utc(event.timestamp)}</time>
        <strong>{eventName(event)} · {event.channel} {event.eventId}</strong>
        <details className="endpoint-sensitive">
          <summary>Show private event details</summary>
          <p>Local account, address and process data may be sensitive. Text is untrusted; nothing shown here is executed.</p>
          <dl>
            <dt>Computer</dt><dd>{event.host || 'Not recorded'}</dd>
            <dt>Account</dt><dd>{event.user || 'Not recorded'}</dd>
            <dt>Observed source address</dt><dd>{event.sourceIp || 'Not recorded'}</dd>
            <dt>Process</dt><dd>{event.process || 'Not recorded'}</dd>
            {event.commandLine && <><dt>Command line · never executed</dt><dd>{event.commandLine}</dd></>}
          </dl>
        </details>
      </li> : <DefenderEvidence key={event.id} event={event} />)}
    </ol>}
  </>
}

function DefenderEvidence({ event }: { event: DefenderEvent }) {
  return <li>
    <time dateTime={event.timestamp}>{utc(event.timestamp)}</time>
    <strong>{defenderEventName(event.eventId)} · Event {event.eventId}</strong>
    <p>{event.threatName || 'Threat name not recorded'}</p>
    <details className="endpoint-sensitive">
      <summary>Show Defender record identifiers</summary>
      <dl><dt>Detection ID</dt><dd>{event.detectionId || 'Not recorded'}</dd><dt>Threat ID</dt><dd>{event.threatId || 'Not recorded'}</dd><dt>Action ID</dt><dd>{event.actionId ?? 'Not recorded'}</dd>{event.errorCode && <><dt>Error code</dt><dd>{event.errorCode}</dd></>}</dl>
    </details>
  </li>
}

export function EndpointMonitor() {
  const [snapshot, setSnapshot] = useState<EndpointSnapshot | null>(null)
  const [available, setAvailable] = useState(false)
  const [busy, setBusy] = useState<'connecting' | 'starting' | 'stopping' | null>('connecting')
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState('')
  const [consent, setConsent] = useState(false)
  const [includeSysmon, setIncludeSysmon] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [reviews, setReviews] = useState<Record<string, Review>>({})
  const [announcement, setAnnouncement] = useState('Connecting to the local monitoring service.')
  const [notificationsEnabled, setNotificationsEnabled] = useState(false)
  const [notificationMessage, setNotificationMessage] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const sessionToken = useRef<string | null>(null)
  const generation = useRef(0)
  const pending = useRef(false)
  const seenFindings = useRef<Set<string> | null>(null)
  const notificationPreference = useRef(false)

  function commit(value: EndpointSnapshot) {
    const current = new Set(value.findings.map((finding) => finding.id))
    const newCount = seenFindings.current ? value.findings.filter((finding) => !seenFindings.current!.has(finding.id)).length : 0
    seenFindings.current = current
    if (newCount > 0 && notificationPreference.current && value.status === 'running' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification('New PC findings to review', { body: 'Open Cyber Intelligence Lab to review the evidence. No security action was taken by this app.', tag: 'cyber-lab-endpoint-findings' })
        setNotificationMessage('A generic notification was sent for new findings. Review the queue below.')
      } catch { setNotificationMessage('Browser notifications could not be displayed. Check the review queue in this tab.') }
    }
    setSnapshot(value); setError(''); setErrorCode(''); setNow(Date.now())
  }

  async function connect() {
    const requestId = ++generation.current
    pending.current = true; sessionToken.current = null; setBusy('connecting'); setError(''); setErrorCode('')
    try {
      const session = await openEndpointSession()
      if (requestId !== generation.current) return
      setAvailable(session.available)
      if (!session.available) {
        setAnnouncement('Monitoring is unavailable. Run this app locally on a Windows PC.')
        return
      }
      sessionToken.current = session.token
      const value = await readEndpointStatus(session.token)
      if (requestId !== generation.current) return
      commit(value)
      setIncludeSysmon(value.includeSysmon)
      setAnnouncement(value.status === 'running' ? 'Connected to the running local monitor.' : 'Local service connected. Monitoring has not been started.')
    } catch (failure) {
      if (requestId !== generation.current) return
      setAvailable(false); setError(errorMessage(failure)); setErrorCode(failure instanceof EndpointClientError ? failure.code : '')
      setAnnouncement('Cannot verify the PC monitoring status.')
    } finally {
      if (requestId === generation.current) { pending.current = false; setBusy(null) }
    }
  }

  useEffect(() => {
    let mounted = true
    void Promise.resolve().then(() => { if (mounted) void connect() })
    const timer = setInterval(async () => {
      setNow(Date.now())
      if (!sessionToken.current || pending.current) return
      const requestId = generation.current
      pending.current = true
      try {
        const value = await readEndpointStatus(sessionToken.current)
        if (requestId === generation.current) commit(value)
      } catch (failure) {
        if (requestId === generation.current) { setError(errorMessage(failure)); setErrorCode(failure instanceof EndpointClientError ? failure.code : '') }
      } finally { if (requestId === generation.current) pending.current = false }
    }, 5000)
    return () => { mounted = false; generation.current += 1; clearInterval(timer); sessionToken.current = null; notificationPreference.current = false }
  }, [])

  async function changeMonitoring(action: 'start' | 'stop') {
    if (!sessionToken.current || pending.current || (action === 'start' && !consent)) return
    const requestId = ++generation.current
    const token = sessionToken.current
    pending.current = true; setBusy(action === 'start' ? 'starting' : 'stopping'); setError(''); setErrorCode('')
    if (action === 'start') seenFindings.current = null
    setAnnouncement(action === 'start' ? 'Starting the collector and reading its first observation window.' : 'Stopping the collector and clearing its private records.')
    try {
      const value = action === 'start' ? await startEndpointMonitor(token, includeSysmon) : await stopEndpointMonitor(token)
      if (requestId !== generation.current) return
      commit(value)
      if (action === 'stop') { setReviews({}); setSelectedId(''); seenFindings.current = null }
      setAnnouncement(action === 'start' ? 'Local monitoring started. Review source coverage and any returned findings below.' : 'Local monitoring stopped. Server-side event history was cleared.')
    } catch (failure) {
      if (requestId === generation.current) { setError(errorMessage(failure)); setErrorCode(failure instanceof EndpointClientError ? failure.code : ''); setAnnouncement('The request failed. Monitoring status has not been confirmed.') }
    } finally { if (requestId === generation.current) { pending.current = false; setBusy(null) } }
  }

  async function enableNotifications() {
    const requestId = generation.current
    if (typeof Notification === 'undefined' || !window.isSecureContext) { setNotificationMessage('Notifications are unavailable in this browser. Keep this tab open to review new findings.'); return }
    try {
      const permission = await Notification.requestPermission()
      if (requestId !== generation.current) return
      if (permission === 'granted') { notificationPreference.current = true; setNotificationsEnabled(true); setNotificationMessage('Generic notifications enabled while this tab is open. Existing findings will not trigger a notification.') }
      else { notificationPreference.current = false; setNotificationsEnabled(false); setNotificationMessage('Notification permission was not granted. You can still review every finding here.') }
    } catch { setNotificationMessage('Notification permission could not be requested. Review the queue in this tab instead.') }
  }

  const findings = useMemo(() => (snapshot?.findings ?? []).filter((finding) => (filter === 'all' || finding.kind === filter) && (!query.trim() || [finding.title, finding.summary, finding.ruleId ?? ''].some((text) => text.toLowerCase().includes(query.trim().toLowerCase())))).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)), [snapshot, filter, query])
  const pages = Math.max(1, Math.ceil(findings.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages - 1)
  const visible = findings.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
  const selected = snapshot?.findings.find((finding) => finding.id === selectedId) ?? visible[0]
  const running = snapshot?.status === 'running'
  const stale = Boolean(error || snapshot?.stale || (snapshot?.lastCheckedAt && now - Date.parse(snapshot.lastCheckedAt) > Math.max(90000, snapshot.limits.pollIntervalMs * 3)))
  const checked = Boolean(snapshot?.lastCheckedAt)
  const healthConcerns = snapshot?.defender.state === 'available' ? [snapshot.defender.antivirusEnabled === false ? 'Microsoft Defender antivirus is not enabled.' : '', snapshot.defender.realTimeProtectionEnabled === false ? 'Microsoft Defender real-time protection is not enabled.' : ''].filter(Boolean) : []
  const defenderSettingsKnown = snapshot?.defender.state === 'available' && typeof snapshot.defender.antivirusEnabled === 'boolean' && typeof snapshot.defender.realTimeProtectionEnabled === 'boolean'
  const noEventSources = checked && snapshot?.coverage.every((source) => source.state !== 'available')
  const stateTitle = busy === 'starting' ? 'Starting the first check…' : busy === 'stopping' ? 'Stopping monitoring…' : busy === 'connecting' ? 'Connecting to the local app…' : error && snapshot ? 'Monitoring status unknown' : !available ? 'Local monitoring unavailable' : error ? 'Monitoring status unknown' : running ? noEventSources ? snapshot?.defender.state === 'available' ? 'Status only · event sources unavailable' : 'Collector running · no readable event sources' : 'Monitoring this PC' : snapshot?.status === 'stopped' ? 'Monitoring stopped' : 'Ready when you are'
  const stateDescription = running ? 'The collector checks every 30 seconds while the local app server runs, even if you close this tab. Stop monitoring here to clear its event history.' : 'Read Microsoft Defender findings and available Security logs from this PC. Collection is read-only: no scans, file removal or settings changes.'
  const statusCounts = snapshot?.findings ?? []

  return <section id="endpoint" className="endpoint-section" aria-labelledby="endpoint-heading">
    <div className="endpoint-heading">
      <div><p className="kicker">Own-PC monitoring · real Windows signals</p><h2 id="endpoint-heading">Understand what your PC reports.</h2><p>Review actual Microsoft Defender detections and explainable log-rule matches. No teaching data is used here. No AI service or paid tokens are required.</p></div>
      <span className="endpoint-local-label">Runs on your Windows PC<br /><strong>Local-only · read-only</strong></span>
    </div>
    <div className="endpoint-control">
      <div>
        <div className="endpoint-control-state">{stateTitle}</div>
        <p>{running && error ? 'The app cannot verify whether the collector is still running. Reconnect to stop it, or stop the local app with Ctrl+C in its terminal.' : !available && !busy ? errorCode === 'endpoint_local_only' ? 'A public website cannot inspect your PC. Run this repository locally with start.bat or npm run dev, then open the address printed by its terminal.' : 'Use start.bat or npm run dev in this repository on Windows, keep the terminal open, and reconnect here. A hosted copy has no access to your device.' : stateDescription}</p>
        {!running && <div className="endpoint-consent"><input id="endpoint-consent" type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={Boolean(busy)} /><label htmlFor="endpoint-consent">I own or am authorised to monitor the PC running this app. Start reads its recent local security records.</label></div>}
      </div>
      <div className="endpoint-control-actions">
        {running ? <button type="button" disabled={!available || Boolean(busy)} onClick={() => void changeMonitoring('stop')}>{busy === 'stopping' ? 'Stopping…' : !available ? 'Reconnect to stop monitoring' : 'Stop and clear monitoring'}</button> : <button type="button" className="endpoint-start" disabled={!available || !consent || Boolean(busy)} onClick={() => void changeMonitoring('start')}>{busy === 'starting' ? 'Starting…' : 'Start monitoring this PC'}</button>}
        <button type="button" disabled={Boolean(busy)} onClick={() => void connect()}>{busy === 'connecting' ? 'Connecting…' : 'Reconnect local service'}</button>
      </div>
    </div>
    <details className="endpoint-options"><summary>What gets read & optional process coverage</summary><p>Defender protection status and events 1116–1119, plus readable Security logon events 4624/4625, from a rolling 15-minute query window. In-memory history is capped at one hour and may be shorter at high volume. Defender file paths are not collected.</p><div className="endpoint-consent"><input id="endpoint-sysmon" type="checkbox" checked={includeSysmon} onChange={(event) => setIncludeSysmon(event.target.checked)} disabled={running || Boolean(busy)} /><label htmlFor="endpoint-sysmon">Also read existing Sysmon process-creation events (1). Requires an already installed and readable Sysmon log.</label></div><p>Stop first to change coverage. Nothing installs Sysmon, elevates permissions, changes auditing or turns off protection.</p></details>
    <p className="endpoint-connection"><strong>{error || !available ? 'Collector status not verified' : running ? 'Collector running' : 'Collector not running'}</strong> · {snapshot?.lastCheckedAt ? <>Last successful collector check: <time dateTime={snapshot.lastCheckedAt}>{utc(snapshot.lastCheckedAt)}</time>{snapshot.pollInProgress ? ' · Next check in progress' : ''}</> : 'No successful collector check yet'}. The page refreshes its status every 5 seconds.</p>
    {error && <div className="endpoint-error" role="alert"><p>{error}</p>{snapshot && <p>Previously returned records remain visible below, but the current status is not verified.</p>}{running && <p>The collector may still be running. Reconnect to stop it, or stop the local app with Ctrl+C in its terminal. Do not assume monitoring has stopped.</p>}</div>}
    {!error && stale && <p className="endpoint-stale" role="status">Collector data is stale or incomplete. Do not treat these records as a current protection status.</p>}
    <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    {snapshot && <>
      <dl className="endpoint-metrics">
        <div><dt>Defender findings in retained history</dt><dd>{checked ? statusCounts.filter((finding) => finding.kind === 'defender').length : '—'}<small>Reported by Microsoft Defender</small></dd></div>
        <div><dt>Suspicious rule matches</dt><dd>{checked ? statusCounts.filter((finding) => finding.kind === 'candidate').length : '—'}<small>Need review; not confirmed attacks</small></dd></div>
        <div><dt>Protection concerns reported</dt><dd>{checked && defenderSettingsKnown ? healthConcerns.length : '—'}<small>{snapshot.defender.state !== 'available' ? 'Defender status unavailable' : !defenderSettingsKnown ? 'Some Defender settings were not reported' : 'Defender settings, not a malware verdict'}</small></dd></div>
      </dl>
      {healthConcerns.length > 0 && <div className="endpoint-stale"><h3>Check Windows Security</h3><ul>{healthConcerns.map((concern) => <li key={concern}>{concern}</li>)}</ul><p>Another antivirus or organisational policy may explain this. Confirm your protection provider in Windows Security before changing anything.</p></div>}
      <div className="endpoint-coverage"><h3>Source coverage</h3><p className="endpoint-coverage-intro">Available means the source was readable—not that your PC is safe. Missing logs, configured audit policies and limited history can hide activity.</p><ul className="endpoint-source-list">{snapshot.coverage.map((source) => <Coverage key={source.source} source={source} checked={checked} />)}</ul>
        {snapshot.defender.state === 'available' && <p className="endpoint-connection">Defender signatures last updated: {snapshot.defender.signaturesUpdatedAt ? <time dateTime={snapshot.defender.signaturesUpdatedAt}>{utc(snapshot.defender.signaturesUpdatedAt)}</time> : 'Not reported'}. This app does not update signatures.</p>}
        {(snapshot.warnings.length > 0 || snapshot.error || snapshot.retentionLimited) && <details><summary>Collection limits & warnings</summary><ul>{snapshot.error && <li>{snapshot.error}</li>}{snapshot.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}{snapshot.retentionLimited && <li>History reached a retention or count limit. Older evidence may no longer be available.</li>}</ul></details>}
      </div>
      <div className="endpoint-workspace">
        <div className="endpoint-queue"><h3>Review queue</h3><p>Provider findings and rule matches stay separate. A recorded Defender action is not proof that the whole PC is clean.</p>
          <div className="endpoint-filters" aria-label="Finding types">{([['all', 'All findings'], ['defender', 'Defender'], ['candidate', 'Rule matches']] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => { setFilter(key); setPage(0); setSelectedId('') }}>{label}</button>)}</div>
          <label className="endpoint-search" htmlFor="endpoint-search">Search returned findings<input id="endpoint-search" type="search" value={query} placeholder="Finding title or rule ID" onChange={(event) => { setQuery(event.target.value); setPage(0); setSelectedId('') }} /></label>
          <div className="endpoint-alert-list">{visible.map((finding) => <button className="endpoint-alert" type="button" key={finding.id} aria-pressed={selected?.id === finding.id} onClick={() => setSelectedId(finding.id)}><span><span className="endpoint-kind" data-kind={finding.kind}>{finding.kind === 'defender' ? 'Defender finding' : 'Suspicious rule match'}</span><span className="endpoint-severity">{finding.severity}</span></span><strong>{finding.title}</strong><small>{outcomeNames[finding.state]} · {reviews[finding.id] === 'follow-up' ? 'Analyst follow-up' : reviews[finding.id] === 'expected-activity' ? 'Analyst: expected activity' : 'Not reviewed'}<br /><time dateTime={finding.lastSeen}>{utc(finding.lastSeen)}</time></small></button>)}</div>
          {visible.length === 0 && <p className="endpoint-empty">{query || filter !== 'all' ? 'No returned findings match this filter.' : !checked ? 'Start monitoring to read real records from this PC.' : 'No findings were returned from the available sources and retained window. This does not establish that the PC is safe.'}</p>}
          {pages > 1 && <div className="endpoint-pagination"><button type="button" disabled={currentPage === 0} onClick={() => { setPage(currentPage - 1); setSelectedId('') }}>Previous findings</button><span>Page {currentPage + 1} of {pages}</span><button type="button" disabled={currentPage >= pages - 1} onClick={() => { setPage(currentPage + 1); setSelectedId('') }}>Next findings</button></div>}
        </div>
        <div className="endpoint-detail">{selected ? <>
          <span className="endpoint-kind" data-kind={selected.kind}>{selected.kind === 'defender' ? 'Microsoft Defender · provider evidence' : `${selected.ruleId ?? 'Local rule'} · candidate, not a confirmed attack`}</span><h3>{selected.title}</h3><p>{selected.summary}</p>
          <dl className="endpoint-meta"><div><dt>Observed provider outcome</dt><dd>{outcomeNames[selected.state]}</dd></div><div><dt>Finding severity</dt><dd>{selected.severity.charAt(0).toUpperCase() + selected.severity.slice(1)} · {selected.kind === 'defender' ? 'Mapped from Defender' : 'Configured rule severity'}</dd></div><div><dt>First evidence</dt><dd><time dateTime={selected.firstSeen}>{utc(selected.firstSeen)}</time></dd></div><div><dt>Latest evidence</dt><dd><time dateTime={selected.lastSeen}>{utc(selected.lastSeen)}</time></dd></div></dl>
          <label className="endpoint-review" htmlFor="endpoint-review">Your analyst review · this tab only<select id="endpoint-review" value={reviews[selected.id] ?? 'unreviewed'} onChange={(event) => setReviews((previous) => ({ ...previous, [selected.id]: event.target.value as Review }))}><option value="unreviewed">Not reviewed</option><option value="follow-up">Needs follow-up</option><option value="expected-activity">Expected activity</option></select><small>A manual review does not resolve a threat or change Defender. Reviews disappear on reload or when monitoring is stopped here.</small></label>
          <Evidence finding={selected} snapshot={snapshot} />
          <div className="endpoint-next"><h4>What to do next</h4><ol>{selected.nextSteps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}</ol>{selected.falsePositives.length > 0 && <details><summary>Other explanations to consider</summary><ul>{selected.falsePositives.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}</ul></details>}</div>
        </> : <><h3>Review evidence before acting.</h3><p>Choose a returned finding to see its source, UTC timeline, observed outcome and practical next steps. No alert is created from a sample in this workspace.</p></>}</div>
      </div>
    </>}
    <div className="endpoint-security-help"><h3>Resolve security findings in Windows Security.</h3><p>Open the Windows Start menu, search for <strong>Windows Security</strong>, then open <strong>Virus & threat protection → Protection history</strong>. Match the detection name and time, and follow the provider’s recommended action. For a fresh check, use <strong>Scan options</strong> there.</p><p>This app does not quarantine, restore, delete or execute anything. Do not restore an item simply because a rule may have a benign explanation. On a work PC, follow your security team’s process.</p>
      <details><summary>Optional notifications while this tab is open</summary><p>Notifications contain only a generic prompt to review new findings—never account names, paths or threat details. They require browser permission and are not background push notifications.</p><div className="endpoint-control-actions" style={{ justifyContent: 'flex-start', marginTop: 14 }}>{notificationsEnabled ? <button type="button" onClick={() => { notificationPreference.current = false; setNotificationsEnabled(false); setNotificationMessage('Tab notifications disabled.') }}>Disable tab notifications</button> : <button type="button" onClick={() => void enableNotifications()}>Enable tab notifications</button>}</div>{notificationMessage && <p role="status">{notificationMessage}</p>}</details>
    </div>
    <p className="endpoint-boundary">Limited local visibility, not a replacement for antivirus or an enterprise EDR. The app cannot monitor visitors to a publicly hosted copy, identify an attacker behind a VPN, or prove that unreported activity is harmless. Public advisories and practice scenarios elsewhere on this page are not evidence about this PC.</p>
    <a className="endpoint-import-link" href="#investigation">Investigate an exported log instead →</a>
    <details className="endpoint-privacy"><summary>Privacy, retention & how to stop</summary><p>Private records stay in this local app server’s memory and this browser tab; they are not sent to a cloud or AI provider. Stop monitoring clears the collector’s history. Closing the terminal stops the collector. Closing only this tab does not stop it. Other authorised tabs connected to the same local app share its collector. Manual reviews and notification settings belong only to this tab.</p><p>Optional Sysmon coverage may include process command lines. Reveal private event details only when needed. The app does not store these records in browser storage or export them automatically.</p></details>
  </section>
}
