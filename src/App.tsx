import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useLiveIntel } from './hooks/useLiveIntel'
import { useLabMotion } from './hooks/useLabMotion'
import { nextTab } from './lib/keyboard-tabs'
import { createVisibleInterval } from './lib/visible-interval'
import { createSimulationSnapshot, advanceSimulationSnapshot, SIMULATION_INTERVAL_MS } from './lib/simulation'
import type { SimulationSnapshot } from './lib/simulation'
import { createDemoSession } from './lib/demo-scenarios'
import type { DemoIncident as Alert, Severity } from './lib/demo-scenarios'
import type { ArtifactTab } from './data/scenarios'
import { LiveIntelSection } from './components/LiveIntelSection'
import { SimulationConsole } from './components/SimulationConsole'
import { IncidentWorkspace } from './components/IncidentWorkspace'
import { LogInvestigation } from './components/LogInvestigation'
import { EndpointMonitor } from './components/EndpointMonitor'
import { resolveWorkspaceHash, workspaceHash, workspaces } from './lib/workspace-navigation'
import type { WorkspaceId } from './lib/workspace-navigation'
import './App.css'
import './lab-motion.css'
import './workspace.css'

// Random seeds are for varied teaching fixtures, not secrets or authentication.
function freshDemoSeed(previous?: number) {
  let seed: number
  try { seed = crypto.getRandomValues(new Uint32Array(1))[0] }
  catch { seed = Math.floor(Math.random() * 0x100000000) }
  return seed === previous ? (seed + 1) >>> 0 : seed
}

function severityLabel(severity: Severity) {
  return severity.toUpperCase()
}

function App() {
  const [navigation, setNavigation] = useState(() => {
    const route = resolveWorkspaceHash(window.location.hash)
    return { route, visited: new Set<WorkspaceId>(route.workspace ? [route.workspace] : []), sequence: 0 }
  })
  const motion = useLabMotion(navigation.route.workspace)
  const currentRoute = useRef(navigation.route)

  const [selectedSeverity, setSelectedSeverity] = useState<'all' | Severity>('all')
  const [session, setSession] = useState(() => createDemoSession(freshDemoSeed()))
  const [selectedAlert, setSelectedAlert] = useState<Alert>(session.initialIncidents[0])
  const [snapshot, setSnapshot] = useState(() => createSimulationSnapshot(session.seed))
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [simulationRunning, setSimulationRunning] = useState(false)
  const [simulationStarted, setSimulationStarted] = useState(false)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle')
  const copyRequest = useRef(0)
  const intel = useLiveIntel()

  useEffect(() => {
    const onHashChange = () => {
      const route = resolveWorkspaceHash(window.location.hash, currentRoute.current.workspace)
      if (currentRoute.current.workspace === 'training' && route.workspace !== 'training') {
        // Close the native modal before its opener becomes inert. A view change
        // pauses replay, but never stops real endpoint monitoring.
        document.querySelector<HTMLDialogElement>('.incident-workspace[open]')?.close()
        setWorkspaceOpen(false)
        setSimulationRunning(false)
      }
      setNavigation((previous) => ({
        route,
        visited: route.workspace ? new Set([...previous.visited, route.workspace]) : previous.visited,
        sequence: previous.sequence + 1,
      }))
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    currentRoute.current = navigation.route
    const { workspace, anchor, skipLink } = navigation.route
    const title = workspaces.find((item) => item.id === workspace)?.title ?? 'Workspace not found'
    document.title = `${title} | Cyber Intelligence Lab`
    const frame = window.requestAnimationFrame(() => {
      if (skipLink) {
        document.getElementById('main-content')?.focus()
        return
      }
      const isSubsection = anchor === 'response' || anchor === 'selected-demo-alert' || anchor === 'source-diagnostics'
      const target = isSubsection ? document.getElementById(anchor) : document.getElementById(`workspace-heading-${workspace ?? 'missing'}`)
      if (isSubsection) target?.scrollIntoView({ block: 'start', behavior: 'instant' })
      else window.scrollTo({ top: 0, behavior: 'instant' })
      // Initial loading must not steal focus from a restored input or deep link.
      if (navigation.sequence > 0) {
        if (target && isSubsection) target.tabIndex = -1
        target?.focus({ preventScroll: true })
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [navigation])

  useEffect(() => {
    if (!simulationRunning || navigation.route.workspace !== 'training') return
    return createVisibleInterval(() => {
      setSnapshot((current) => advanceSimulationSnapshot(current, session.seed))
    }, SIMULATION_INTERVAL_MS, document)
  }, [simulationRunning, session.seed, navigation.route.workspace])

  function toggleSimulation() {
    if (!simulationStarted) {
      setSnapshot((current) => advanceSimulationSnapshot(current, session.seed))
      setSimulationStarted(true)
    }
    setSimulationRunning((running) => !running)
  }

  function resetSimulation() {
    setSimulationRunning(false)
    setSimulationStarted(false)
    const next = createDemoSession(freshDemoSeed(session.seed))
    setSession(next)
    setSnapshot(createSimulationSnapshot(next.seed))
    setSelectedAlert(next.initialIncidents[0])
    setSelectedSeverity('all')
    copyRequest.current += 1
    setCopyStatus('idle')
    setWorkspaceOpen(false)
  }

  useEffect(() => {
    return () => { copyRequest.current += 1 }
  }, [])

  useEffect(() => {
    if (copyStatus !== 'copied') return
    const timer = window.setTimeout(() => setCopyStatus('idle'), 2400)
    return () => window.clearTimeout(timer)
  }, [copyStatus])

  const currentAlerts = [...snapshot.recentEvents.map((event) => event.incident), ...session.initialIncidents]
  const alerts = currentAlerts.some((alert) => alert.id === selectedAlert.id)
    ? currentAlerts : [selectedAlert, ...currentAlerts]
  const filteredAlerts = selectedSeverity === 'all' ? alerts : alerts.filter((alert) => alert.severity === selectedSeverity)

  function selectAlert(alert: Alert) {
    copyRequest.current += 1
    setCopyStatus('idle')
    setSelectedAlert(alert)
  }

  function inspectAlert(alert: Alert, fromActivity = false) {
    selectAlert(alert)
    if (fromActivity) setSelectedSeverity('all')
    setSimulationRunning(false)
    setWorkspaceOpen(true)
  }

  function handleSeverityChange(nextSeverity: 'all' | Severity) {
    setSelectedSeverity(nextSeverity)
    if (nextSeverity !== 'all' && selectedAlert.severity !== nextSeverity) {
      const next = alerts.find((alert) => alert.severity === nextSeverity)
      if (next) selectAlert(next)
    }
  }

  async function copyBrief() {
    const request = ++copyRequest.current
    setCopyStatus('copying')
    const scenario = selectedAlert.details
    const brief = [
      'SIMULATED INCIDENT — learning exercise, not live telemetry',
      `${selectedAlert.id} | ${selectedAlert.title}`,
      `Severity: ${selectedAlert.severity} | Illustrative risk: ${scenario.riskScore}/100`,
      `Asset: ${selectedAlert.asset} | Technique: ${selectedAlert.technique}`,
      scenario.summary,
      'Proposed exercise steps:',
      ...scenario.actions.map((action, index) => `${index + 1}. ${action.label} (${action.priority})`),
      'No real systems were monitored or changed by this simulation.',
    ].join('\n')
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(brief)
      if (copyRequest.current === request) setCopyStatus('copied')
    } catch {
      if (copyRequest.current === request) setCopyStatus('error')
    }
  }

  return (
    <div className={`site-shell${simulationRunning ? '' : ' simulation-paused'}`} data-motion={motion.enabled ? 'on' : 'off'} data-motion-paused={motion.hidden}>
      <a className="skip-link" href="#main-content" onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        document.getElementById('main-content')?.focus()
      }}>Skip to content</a>
      <Navigation active={navigation.route.workspace} />
      <main id="main-content" tabIndex={-1}>
        {navigation.visited.has('overview') && <div className="workspace-view" data-workspace="overview" hidden={navigation.route.workspace !== 'overview'} inert={navigation.route.workspace !== 'overview'}><Overview /></div>}
        {navigation.visited.has('endpoint') && <div className="workspace-view" data-workspace="endpoint" hidden={navigation.route.workspace !== 'endpoint'} inert={navigation.route.workspace !== 'endpoint'}><WorkspaceHeader workspace="endpoint" /><EndpointMonitor /></div>}
        {navigation.visited.has('investigation') && <div className="workspace-view" data-workspace="investigation" hidden={navigation.route.workspace !== 'investigation'} inert={navigation.route.workspace !== 'investigation'}><WorkspaceHeader workspace="investigation" /><LogInvestigation /></div>}
        {navigation.visited.has('live-intel') && <div className="workspace-view" data-workspace="live-intel" hidden={navigation.route.workspace !== 'live-intel'} inert={navigation.route.workspace !== 'live-intel'}><WorkspaceHeader workspace="live-intel" /><LiveIntelSection liveIntel={intel.data} state={intel} onRefresh={intel.refresh} /></div>}
        {navigation.visited.has('training') && <div className="workspace-view" data-workspace="training" hidden={navigation.route.workspace !== 'training'} inert={navigation.route.workspace !== 'training'}>
          <WorkspaceHeader workspace="training" motion={motion} />
          <ThreatOperations
          snapshot={snapshot}
          sessionId={session.id}
          selectedSeverity={selectedSeverity}
          selectedAlert={selectedAlert}
          filteredAlerts={filteredAlerts}
          allAlerts={alerts}
          onSeverityChange={handleSeverityChange}
          onSelectAlert={(id) => { const alert = alerts.find((item) => item.id === id); if (alert) inspectAlert(alert) }}
          onSelectActivity={(alert) => inspectAlert(alert, true)}
          onInspect={() => inspectAlert(selectedAlert)}
          onPauseForReview={() => setSimulationRunning(false)}
          onCopyBrief={copyBrief}
          copyStatus={copyStatus}
          simulationRunning={simulationRunning}
          simulationStarted={simulationStarted}
          simulationHidden={motion.hidden}
          motionEnabled={motion.enabled}
          onToggleSimulation={toggleSimulation}
          onResetSimulation={resetSimulation}
          />
          <IncidentResponse selectedAlert={selectedAlert} />
        </div>}
        {navigation.route.workspace === null && <div className="workspace-view" data-workspace="missing"><header className="workspace-page-header"><div className="workspace-page-heading"><h1 id="workspace-heading-missing" tabIndex={-1}>Workspace not found</h1><p className="workspace-description">This link does not match a workspace. Choose a section from the navigation or return to the overview.</p></div></header><a className="button button-primary" href="#overview">Open overview</a></div>}
      </main>
      <Footer workspace={navigation.route.workspace} />
      <IncidentWorkspace incident={workspaceOpen && navigation.route.workspace === 'training' ? selectedAlert : null} onClose={() => setWorkspaceOpen(false)} motionEnabled={motion.enabled} />
    </div>
  )
}

function Navigation({ active }: { active: WorkspaceId | null }) {
  return (
    <header className="nav-frame" aria-label="Primary navigation">
      <a className="brand" href="#overview" aria-label="Cyber Intelligence Lab home"><span className="brand-mark">CIL<span className="brand-period">.</span></span><span>Cyber Intelligence Lab</span></a>
      <nav className="nav-links" aria-label="Primary navigation">
        {workspaces.map(({ id, hash, label }) => <a key={id} href={hash} aria-current={active === id ? 'page' : undefined} onClick={(event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
          if (window.location.hash !== hash) return
          event.preventDefault()
          window.scrollTo({ top: 0, behavior: 'instant' })
          document.getElementById(`workspace-heading-${id}`)?.focus({ preventScroll: true })
        }}>{label}</a>)}
      </nav>
    </header>
  )
}

function WorkspaceHeader({ workspace, motion }: { workspace: WorkspaceId; motion?: ReturnType<typeof useLabMotion> }) {
  const definition = workspaces.find((item) => item.id === workspace)!
  return <header className="workspace-page-header">
    <div className="workspace-page-heading"><h1 id={`workspace-heading-${workspace}`} tabIndex={-1}>{definition.title}</h1><p className="workspace-description">{definition.description}</p></div>
    {motion && <div className="workspace-header-action"><button className="motion-toggle" type="button" aria-pressed={motion.enabled} disabled={motion.reduced} onClick={motion.toggle} title={motion.reduced ? 'Motion is off to respect your system reduced-motion setting.' : 'Turn decorative motion on or off. Simulation controls are separate.'}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d={motion.enabled ? 'M5.5 3v10M10.5 3v10' : 'M5 3l7 5-7 5z'} /></svg>
      Motion {motion.enabled ? 'on' : 'off'}
    </button></div>}
  </header>
}

function Overview() {
  const tasks = [
    { hash: '#live-intel', title: 'Live intelligence', description: 'Read official vulnerability and security updates, with public community context.' },
    { hash: '#operations', title: 'Training', description: 'Practice reviewing fictional alerts, their evidence and proposed responses.' },
  ]
  return <section className="workspace-overview" id="overview" aria-labelledby="workspace-heading-overview">
    <div className="workspace-overview-intro">
      <p className="kicker">Cyber Intelligence Lab</p>
      <h1 id="workspace-heading-overview" tabIndex={-1}>Your security workspace.</h1>
      <p className="workspace-overview-description">Monitor this PC, investigate your logs or review public security updates.</p>
      <div className="workspace-primary-actions" role="group" aria-label="Primary actions">
        <a className="button button-primary" href="#endpoint"><span>Monitor this PC</span><span className="button-glyph" aria-hidden="true">↗</span></a>
        <a className="button button-secondary" href="#investigation"><span>Investigate local logs</span><span className="button-glyph" aria-hidden="true">↗</span></a>
      </div>
    </div>
    <div className="workspace-task-list">{tasks.map((task) => <article key={task.hash}><a className="workspace-task-link" href={task.hash}><div><h2>{task.title}</h2><p>{task.description}</p></div><span aria-hidden="true">↗</span></a></article>)}</div>
  </section>
}
function ThreatOperations({
  snapshot,
  sessionId,
  onSelectActivity,
  onInspect,
  onPauseForReview,
  selectedSeverity,
  selectedAlert,
  filteredAlerts,
  allAlerts,
  onSeverityChange,
  onSelectAlert,
  onCopyBrief,
  copyStatus,
  simulationRunning,
  simulationStarted,
  simulationHidden,
  motionEnabled,
  onToggleSimulation,
  onResetSimulation,
}: {
  snapshot: SimulationSnapshot
  sessionId: string
  onSelectActivity: (alert: Alert) => void
  onInspect: () => void
  onPauseForReview: () => void
  selectedSeverity: 'all' | Severity
  selectedAlert: Alert
  filteredAlerts: Alert[]
  allAlerts: Alert[]
  onSeverityChange: (severity: 'all' | Severity) => void
  onSelectAlert: (id: Alert['id']) => void
  onCopyBrief: () => void
  copyStatus: 'idle' | 'copying' | 'copied' | 'error'
  simulationRunning: boolean
  simulationStarted: boolean
  simulationHidden: boolean
  motionEnabled: boolean
  onToggleSimulation: () => void
  onResetSimulation: () => void
}) {
  const scenario = selectedAlert.details
  const severityOptions: Array<'all' | Severity> = ['all', 'critical', 'high', 'medium', 'low']

  return (
    <section className="operations-section" id="operations">
      <div className="section-header reveal">
        <span>02.</span>
        <div>
          <p className="kicker">Threat operations / simulation</p>
          <h2>Investigate. Understand. Respond.</h2>
        </div>
        <p className="quote">Select an incident to explore its evidence and response. All data in this workspace is simulated.</p>
      </div>

      <div className="workspace-note">
        <span className="mode-tag">Simulation workspace</span>
        <nav className="workspace-steps" aria-label="Investigation steps">
          <button type="button" onClick={() => { const row = document.querySelector<HTMLButtonElement>('.queue-row[aria-pressed="true"]') ?? document.querySelector<HTMLButtonElement>('.queue-row'); row?.focus(); }}>1. Select an incident</button>
          <button type="button" onClick={onInspect}>2. Review evidence</button>
          <a href="#response" onClick={(event) => { event.preventDefault(); onInspect() }}>3. Open its response</a>
        </nav>
      </div>
      <div className="ops-grid reveal delay-1">
        <aside className="panel actor-panel">
          <div className="panel-title">Queue by region</div>
          <p className="queue-context-note">Current demo queue only · not global detections</p>
          <dl className="queue-region-list">
            {snapshot.regions.map((region) => (
              <div key={region.code}><dt>{region.label}</dt><dd>{allAlerts.filter((alert) => alert.regionCode === region.code).length} incidents</dd></div>
            ))}
          </dl>
        </aside>

        <div className="panel map-panel">
          <SimulationConsole snapshot={snapshot} sessionId={sessionId} selectedIncidentId={selectedAlert.id}
            running={simulationRunning} hasStarted={simulationStarted} hidden={simulationHidden} motionEnabled={motionEnabled}
            onSelectIncident={onSelectActivity} onPauseForReview={onPauseForReview}
            onToggle={onToggleSimulation} onReset={onResetSimulation}>
            <ThreatMap compact snapshot={snapshot} activeRegion={simulationRunning && !simulationHidden ? snapshot.recentEvents[0]?.regionCode : undefined} />
          </SimulationConsole>
        </div>

        <aside className="panel alert-panel" id="selected-demo-alert" tabIndex={-1} aria-live="polite" data-incident-id={selectedAlert.id} data-template-id={selectedAlert.templateId} data-asset={selectedAlert.asset}>
          <div className="panel-heading">
            <div>
              <div className="panel-title">Selected demo alert</div>
              <small>#{selectedAlert.id}</small>
            </div>
            <span className={`severity-badge ${selectedAlert.severity}`}>
              {severityLabel(selectedAlert.severity)}
            </span>
          </div>
          <h3 className="lab-content-change" key={selectedAlert.id}>{selectedAlert.title}</h3>
          <dl className="detail-list">
            <div>
              <dt>Source</dt>
              <dd>{selectedAlert.actor}</dd>
            </div>
            <div>
              <dt>Asset</dt>
              <dd>{selectedAlert.asset}</dd>
            </div>
            <div>
              <dt>Vector</dt>
              <dd>{selectedAlert.vector}</dd>
            </div>
            <div>
              <dt>Technique</dt>
              <dd>{selectedAlert.technique}</dd>
            </div>
            <div>
              <dt>Exercise status</dt>
              <dd>{selectedAlert.status}</dd>
            </div>
          </dl>
          <div className="action-row">
            <a className="button button-primary slim" href="#response" onClick={(event) => { event.preventDefault(); onInspect() }}>
              View response
            </a>
            <button className="button button-secondary slim" type="button" onClick={onCopyBrief} disabled={copyStatus === 'copying'}>
              {copyStatus === 'copied' ? 'Brief copied' : copyStatus === 'copying' ? 'Copying…' : 'Copy brief'}
            </button>
          </div>
          <p className="copy-feedback" role="status">
            {copyStatus === 'error' ? 'Clipboard access is unavailable. Select and copy the alert details instead.' : copyStatus === 'copied' ? 'Demo brief copied to clipboard.' : ''}
          </p>
          <div className="related-iocs">
            <div className="panel-title">Example IOCs / reserved addresses</div>
            {scenario.indicators.map(([label, value]) => (
              <div className="ioc-row" key={label}>
                <span>{label}</span>
                <code>{value}</code>
              </div>
            ))}
          </div>
          <div className="containment-mini">
            <div className="panel-title">Example containment status</div>
            {scenario.containment.map((item) => (
              <p className="checklist-item" key={item.label}>
                <span className={item.done ? 'checklist-state' : 'checklist-state pending'}>{item.done ? 'Done' : 'Pending'}</span>
                <span>{item.label}</span>
              </p>
            ))}
          </div>
        </aside>

        <div className="panel queue-panel">
          <div className="panel-heading">
            <div>
              <div className="panel-title">Demo incident queue</div>
              <small>{filteredAlerts.length} filtered signals</small>
            </div>
            <div className="severity-filter" role="group" aria-label="Threat severity filter">
              {severityOptions.map((severity) => (
                <button
                  className={selectedSeverity === severity ? 'active' : ''}
                  key={severity}
                  type="button"
                  aria-pressed={selectedSeverity === severity}
                  onClick={() => onSeverityChange(severity)}
                >
                  {severity}
                </button>
              ))}
            </div>
          </div>
          <div className="queue-table" onFocusCapture={onPauseForReview}>
            {filteredAlerts.map((alert) => (
              <button
                className={selectedAlert.id === alert.id ? 'queue-row active' : 'queue-row'}
                key={alert.id}
                data-incident-id={alert.id}
                data-template-id={alert.templateId}
                data-asset={alert.asset}
                type="button"
                aria-pressed={selectedAlert.id === alert.id}
                aria-haspopup="dialog"
                aria-label={`${alert.title}, ${alert.severity}, ${alert.region}, ${alert.time}`}
                onClick={() => onSelectAlert(alert.id)}
              >
                <time>{alert.time}</time>
                <span className={`severity-dot ${alert.severity}`} aria-hidden="true"></span>
                <strong>{alert.title}</strong>
                <span className={`queue-severity ${alert.severity}`}>{alert.severity}</span><small>{alert.region}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="panel stream-panel">
          <div className="panel-title">Selected network evidence</div>
          <p className="queue-context-note">{selectedAlert.asset} · synthetic evidence</p>
          <dl className="detail-list">
            {scenario.artifacts.network.fields.map(([label, value]) => (
              <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
            ))}
          </dl>
        </div>

        <div className="panel vector-panel">
          <div className="panel-title">Queue by severity</div>
          <p className="queue-context-note">{allAlerts.length} retained incidents · newest activity plus your selection</p>
          {severityOptions.filter((severity) => severity !== 'all').map((severity) => {
            const count = allAlerts.filter((alert) => alert.severity === severity).length
            return <div className="bar-row" key={severity}>
              <span>{severity}</span><div className="bar-track"><i style={{ width: (count / allAlerts.length * 100) + '%' }} /></div><data>{count}</data>
            </div>
          })}
        </div>
      </div>
    </section>
  )
}

function ThreatMap({ compact, snapshot, activeRegion }: { compact: boolean; snapshot: SimulationSnapshot; activeRegion?: string }) {
  return (
    <div className={compact ? 'threat-map compact' : 'threat-map'}>
      <div className="map-visual">
        <div className="map-caption"><span>Simulated regions</span><span>Not live traffic</span></div>
        <div className="map-grid"></div>
        <svg className="lab-instrument" viewBox="0 0 72 54" aria-hidden="true">
          <path className="instrument-frame" d="M9 13V5h8M55 5h8v8M63 41v8h-8M17 49H9v-8M32 27h8M36 23v8" />
          <circle className="instrument-ring" cx="36" cy="27" r="19" />
          <circle className="instrument-wave" cx="36" cy="27" r="15" />
          <g className="instrument-sweep"><path d="M36 27V10M22.5 13.5a19 19 0 0 1 27 0" /></g>
        </svg>
        <svg className="arc-layer" viewBox="0 0 1000 520" aria-hidden="true">
          <path d="M128 222 C 260 54, 480 60, 610 204" />
          <path d="M206 316 C 395 168, 585 160, 806 238" />
          <path d="M628 202 C 718 88, 858 106, 920 198" />
          <path d="M354 198 C 468 106, 694 92, 842 330" />
          <path d="M122 278 C 292 358, 528 402, 886 354" />
        </svg>
        {snapshot.regions.map(({ code, label, count }) => (
          <div className={`map-node ${code}${code === activeRegion ? ' is-active' : ''}`} key={code}>
            <span></span>
            <strong>{label}</strong>
            <data>{count.toLocaleString()}</data>
          </div>
        ))}
      </div>
      <div className="map-readout">
        <span>Demo events</span>
        <data>{snapshot.total.toLocaleString()}</data>
      </div>
    </div>
  )
}

function IncidentResponse({ selectedAlert }: { selectedAlert: Alert }) {
  const [activeArtifactTab, setActiveArtifactTab] = useState<ArtifactTab>('file')
  const scenario = selectedAlert.details
  const activeArtifact = scenario.artifacts[activeArtifactTab]
  const tabs = Object.keys(scenario.artifacts) as ArtifactTab[]

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const tab = nextTab(tabs, activeArtifactTab, event.key)
    if (!tab) return
    event.preventDefault()
    setActiveArtifactTab(tab)
    document.getElementById(`artifact-tab-${tab}`)?.focus()
  }

  return (
    <section className="response-section" id="response" data-incident-id={selectedAlert.id} data-template-id={selectedAlert.templateId} data-asset={selectedAlert.asset}>
      <div className="section-header reveal">
        <span>03.</span>
        <div>
          <p className="kicker">Incident response / simulation</p>
          <h2>From signal to response.</h2>
        </div>
        <p className="quote">Evidence and next steps follow your selected incident. This is a learning exercise, not an automated response.</p>
      </div>

      <div className="scenario-context">
        <span className={`severity-badge ${selectedAlert.severity}`}>{selectedAlert.severity}</span>
        <div>
          <span>Selected scenario / <span className="scenario-id">{selectedAlert.id}</span></span>
          <strong>{selectedAlert.title}</strong>
        </div>
        <a href="#operations">Change incident <span aria-hidden="true">↗</span></a>
      </div>
      <div className="response-grid reveal delay-1">
        <div className="panel timeline-panel">
          <div className="panel-title">Example incident timeline</div>
          <div className="timeline lab-content-change" key={selectedAlert.id}>
            {scenario.timeline.map((item) => (
              <article className={`timeline-item ${item.tone}`} key={item.stage}>
                <time>{item.time}</time>
                <div>
                  <h3>{item.stage}</h3>
                  <p>{item.copy}</p>
                </div>
              </article>
            ))}
          </div>
          <div className="containment-strip">
            <span aria-hidden="true"></span>
            <strong>Simulated containment</strong>
            <small>{scenario.containment.filter((item) => item.done).length} of {scenario.containment.length} example steps complete. No real action taken.</small>
          </div>
        </div>

        <div className="panel triage-panel">
          <div className="panel-heading">
            <div>
              <div className="panel-title">Example triage report</div>
              <small>Randomized teaching template / not AI analysis</small>
            </div>
            <small>Demo data</small>
          </div>
          <p className="scenario-summary lab-content-change" key={selectedAlert.id}>{scenario.summary}</p>
          <div className="risk-grid">
            <div>
              <span>Example risk score</span>
              <strong className={selectedAlert.severity}>{scenario.riskScore}</strong>
              <small>/ 100</small>
            </div>
            <div>
              <span>Selected scenario</span>
              <strong>{selectedAlert.title}</strong>
              <small>{selectedAlert.technique}</small>
            </div>
            <div>
              <span>Scenario phase</span>
              <strong>{scenario.phase}</strong>
              <small>Illustrative assessment</small>
            </div>
          </div>
          <div className="technique-table">
            {scenario.techniques.map(([id, name, phase]) => (
              <div key={id}>
                <code>{id}</code>
                <span>{name}</span>
                <small>{phase}</small>
              </div>
            ))}
          </div>
          <div className="actions-list">
            {scenario.actions.map((action, index) => (
              <div key={action.label}>
                <span>{index + 1}</span>
                <p>{action.label}</p>
                <strong className={`priority-${action.priority.toLowerCase()}`}>{action.priority}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="panel forensic-panel">
          <div className="panel-title">Sample forensic artifacts</div>
          <div className="tab-row" aria-label="Artifact tabs" role="tablist">
            {tabs.map((tab) => (
              <button
                id={`artifact-tab-${tab}`}
                aria-controls="artifact-panel"
                aria-selected={activeArtifactTab === tab}
                tabIndex={activeArtifactTab === tab ? 0 : -1}
                className={activeArtifactTab === tab ? 'active' : ''}
                key={tab}
                onClick={() => setActiveArtifactTab(tab)}
                onKeyDown={handleTabKey}
                role="tab"
                type="button"
              >
                {scenario.artifacts[tab].label}
              </button>
            ))}
          </div>
          <div className="forensic-content" id="artifact-panel" aria-labelledby={`artifact-tab-${activeArtifactTab}`} tabIndex={0} key={`${selectedAlert.id}-${activeArtifactTab}`} role="tabpanel">
            <dl className="detail-list forensic-list">
              {activeArtifact.fields.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <div className="checklist">
              {activeArtifact.checklist.map(([label, done]) => (
                <p className="checklist-item" key={label}>
                  <span className={done ? 'checklist-state' : 'checklist-state pending'}>{done ? 'Done' : 'Pending'}</span>
                  <span>{label}</span>
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Footer({ workspace }: { workspace: WorkspaceId | null }) {
  if (workspace === null) return null
  const scope: Record<WorkspaceId, string> = {
    overview: 'Monitoring is opt-in and requires the local Windows app. Logs stay in this tab. Public feeds and fictional training are not PC detections. No paid AI.',
    endpoint: 'Closing this tab does not stop a started collector.',
    investigation: 'Reload or clear the dataset to discard this tab’s imported records.',
    'live-intel': 'Public records provide context, not evidence of a threat on this PC.',
    training: 'Training is fictional and does not change real systems.',
  }
  return (
    <footer className="footer workspace-footer" data-workspace={workspace}>
      <p className="workspace-footer-note">{scope[workspace]}</p>
      {workspace !== 'overview' && <a className="workspace-back-top" href={workspaceHash(workspace)} onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        const hash = workspaceHash(workspace)
        if (window.location.hash !== hash) { window.location.hash = hash; return }
        window.scrollTo({ top: 0, behavior: 'instant' })
        document.getElementById(`workspace-heading-${workspace ?? 'missing'}`)?.focus({ preventScroll: true })
      }}>
        <span>Back to top</span>
        <span aria-hidden="true">
          ↑
        </span>
      </a>}
    </footer>
  )
}

export default App
