import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { LiveIntelState } from './lib/live-intel'
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
import './App.css'
import './lab-motion.css'

// Random seeds are for varied teaching fixtures, not secrets or authentication.
function freshDemoSeed(previous?: number) {
  let seed: number
  try { seed = crypto.getRandomValues(new Uint32Array(1))[0] }
  catch { seed = Math.floor(Math.random() * 0x100000000) }
  return seed === previous ? (seed + 1) >>> 0 : seed
}

const caseStudies = [
  {
    label: 'Incident response / enterprise',
    title: 'Ransomware containment',
    summary:
      'A fictional ransomware exercise showing how analysts might isolate lateral movement and plan service recovery across a sample estate.',
    impact: '> 99%',
    metric: 'threat contained',
    extra: '1,200 sample endpoints',
    tools: ['CrowdStrike', 'Splunk', 'Velociraptor', 'Wireshark'],
    timeline: '36 hours',
    category: 'Ransomware',
  },
  {
    label: 'Threat hunting / email security',
    title: 'Phishing takedown',
    summary:
      'A fictional email-security exercise covering indicator grouping, evidence review, and a proposed phishing response. No domains were taken down.',
    impact: '> 92%',
    metric: 'traffic reduction target',
    extra: '17 example domains',
    tools: ['MISP', 'Maltego', 'Proofpoint', 'Python'],
    timeline: '2 weeks',
    category: 'Phishing',
  },
  {
    label: 'Cloud security / attack surface',
    title: 'Cloud misconfiguration hunt',
    summary:
      'A fictional cloud-security exercise exploring public exposure and over-permissive access. No real cloud environments were scanned or remediated.',
    impact: '> 70',
    metric: 'example risk findings',
    extra: 'Sample target only',
    tools: ['AWS CLI', 'ScoutSuite', 'Prowler', 'Terraform'],
    timeline: '3 weeks',
    category: 'Misconfiguration',
  },
]

function severityLabel(severity: Severity) {
  return severity.toUpperCase()
}

function App() {
  const motion = useLabMotion()

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
    if (!simulationRunning) return
    return createVisibleInterval(() => {
      setSnapshot((current) => advanceSimulationSnapshot(current, session.seed))
    }, SIMULATION_INTERVAL_MS, document)
  }, [simulationRunning, session.seed])

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
      'No real systems were monitored or changed by this dashboard.',
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
      <a className="skip-link" href="#main-content">Skip to content</a>
      <Navigation />
      <main id="main-content" tabIndex={-1}>
        <Hero snapshot={snapshot} state={intel} motion={motion} />
        <LiveIntelSection liveIntel={intel.data} state={intel} onRefresh={intel.refresh} />
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
        <CaseStudies />
        <SkillMatrix />
      </main>
      <Footer />
      <IncidentWorkspace incident={workspaceOpen ? selectedAlert : null} onClose={() => setWorkspaceOpen(false)} motionEnabled={motion.enabled} />
    </div>
  )
}

function Navigation() {
  const [active, setActive] = useState('top')
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) setActive(entry.target.id)
    }, { rootMargin: '-125px 0px -55% 0px', threshold: 0 })
    document.querySelectorAll('main > section[id]').forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [])
  return (
    <header className="nav-frame" aria-label="Primary navigation">
      <a className="brand" href="#top" aria-label="Cyber Intelligence Lab home"><span className="brand-mark">CIL<span className="brand-period">.</span></span><span>Cyber Intelligence Lab</span></a>
      <nav className="nav-links" aria-label="Primary navigation">
        {[['live-intel', 'Live intel'], ['operations', 'Operations'], ['response', 'Response'], ['cases', 'Cases'], ['skills', 'Skills']].map(([id, label]) => <a key={id} href={`#${id}`} aria-current={active === id ? 'location' : undefined}>{label}</a>)}
      </nav>
    </header>
  )
}

function Hero({ snapshot, state, motion }: { snapshot: SimulationSnapshot; state: LiveIntelState; motion: ReturnType<typeof useLabMotion> }) {
  const available = state.isOnline && (state.status === 'live' || state.status === 'partial')
    ? state.data?.sources.filter((source) => source.status === 'ok').length ?? 0 : null
  const count = state.data ? state.data.kev.length + state.data.news.length + (state.data.advisories?.length ?? 0) : null
  return (
    <section className="hero-section section-grid" id="top">
      <div className="hero-copy reveal">
        <p className="kicker">Independent security engineering</p>
        <h1><span>Cyber</span>{' '}<span>Intelligence</span>{' '}<span>Lab</span></h1>
        <p className="hero-subtitle">Read the signals.{' '}<br /><strong>Understand the response.</strong></p>
        <p className="hero-description">A hands-on workspace connecting real public advisories with randomized, explorable incident scenarios. Built for curious minds, not just security teams.</p>
        <div className="hero-actions" role="group" aria-label="Primary actions">
          <a className="button button-primary" href="#live-intel"><span>Explore live intelligence</span><span className="button-glyph" aria-hidden="true">↗</span></a>
          <a className="button button-secondary" href="#operations"><span>Launch console</span><span className="button-glyph" aria-hidden="true">↗</span></a>
        </div>
        <dl className="signal-strip" aria-label="Workspace overview">
          <div><dt>{available ?? '—'}<span>/3</span></dt><dd>Connected public feeds</dd></div>
          <div><dt>{count ?? '—'}</dt><dd>{state.status === 'live' && state.isOnline ? 'Retrieved records' : 'Saved records'}</dd></div>
          <div><dt>05</dt><dd>Scenario families</dd></div>
        </dl>
        <p className="hero-disclosure">Read-only public intelligence. Simulated incident response. No network monitoring or security actions.</p>
      </div>
      <div className="hero-console reveal delay-1" role="group" aria-label="Illustrative topology and public-source preview">
        <div className="console-topline">
          <span><i aria-hidden="true" /> ANALYST WORKSPACE</span>
          <button className="motion-toggle" type="button" aria-pressed={motion.enabled} disabled={motion.reduced} onClick={motion.toggle} title={motion.reduced ? 'Motion is off to respect your system reduced-motion setting.' : 'Turn decorative motion on or off. Simulation controls are separate.'}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d={motion.enabled ? 'M5.5 3v10M10.5 3v10' : 'M5 3l7 5-7 5z'} /></svg>
            Motion {motion.enabled ? 'on' : 'off'}
          </button>
        </div>
        <ThreatMap compact={false} snapshot={snapshot} />
        <div className="hero-brief">
          <div className="brief-heading"><span>From the current snapshot</span><a href="#live-intel">Explore feeds <span aria-hidden="true">↗</span></a></div>
          <div className="brief-items">
            <article><span>CISA / {state.data?.kev[0]?.id ?? 'Awaiting source'}</span><p>{state.data?.kev[0]?.title ?? 'Public vulnerability records appear after the first successful check.'}</p></article>
            <article><span>Microsoft / official security updates</span><p>{state.data?.advisories?.[0]?.title ?? 'Publisher security updates appear when the Microsoft source is available.'}</p></article>
          </div>
          {state.status !== 'live' && <p className="brief-caveat">{!state.isOnline ? 'Offline. Saved records may be out of date.' : state.data ? 'Some records may be out of date. Check source health below.' : 'Connecting to the public feeds.'}</p>}
        </div>
      </div>
    </section>
  )
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
        <div className="map-caption"><span>Illustrative topology</span><span>Not live traffic</span></div>
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

function CaseStudies() {
  return (
    <section className="case-section" id="cases">
      <div className="case-header reveal">
        <span>04.</span>
        <p className="kicker">Illustrative case studies</p>
        <h2>Practice scenarios. Example outcomes.</h2>
      </div>

      <div className="case-table reveal delay-1">
        {caseStudies.map((study, index) => (
          <article className="case-row" key={study.title}>
            <div className="case-number">{String(index + 1).padStart(2, '0')}</div>
            <div>
              <p>{study.label}</p>
              <h3>{study.title}</h3>
              <span>{study.summary}</span>
            </div>
            <div>
              <p>Illustrative target</p>
              <strong>{study.impact}</strong>
              <span>{study.metric}</span>
              <span>{study.extra}</span>
            </div>
            <div>
              <p>Relevant tools</p>
              {study.tools.map((tool) => (
                <span key={tool}>{tool}</span>
              ))}
            </div>
            <div>
              <p>Example duration</p>
              <strong>{study.timeline}</strong>
            </div>
            <div>
              <p>Threat category</p>
              <strong className="red-text">{study.category}</strong>
            </div>
            <div className="success-box">
              <span></span>
              Illustrative scenario
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function SkillMatrix() {
  return (
    <section className="skills-section" id="skills">
      <div className="skills-copy reveal">
        <p className="kicker">Learning areas</p>
        <h2>Security workflows, explained through examples.</h2>
        <p>
          The React interface demonstrates filtering, source refresh, and accessible navigation. Security scenarios are illustrative, not evidence of completed operations or tool integrations.
        </p>
      </div>
      <div className="skills-grid reveal delay-1">
        {[
          ['Threat intelligence', 'Example indicators, actor context, and simulated map views'],
          ['Incident response', 'Containment plans, timeline reconstruction, prioritized actions'],
          ['MITRE mapping', 'Tactics and techniques attached to every alert workflow'],
          ['Forensic analysis', 'Artifacts, hashes, process chain, and evidence summaries'],
          ['Cloud security', 'Illustrative exposure findings and remediation planning'],
          ['Frontend engineering', 'React, TypeScript, responsive UI, accessible interactions'],
        ].map(([title, copy]) => (
          <article key={title}>
            <h3>{title}</h3>
            <p>{copy}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="footer">
      <div>
        <strong>Cyber Intelligence Lab</strong>
        <span>Defensive simulation with separate public-source intelligence.</span>
      </div>
      <a className="button button-primary" href="#top">
        <span>Back to top</span>
        <span className="button-glyph" aria-hidden="true">
          ↑
        </span>
      </a>
    </footer>
  )
}

export default App
