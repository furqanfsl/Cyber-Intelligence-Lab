import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { LiveIntelState } from './lib/live-intel'
import { useLiveIntel } from './hooks/useLiveIntel'
import { nextTab } from './lib/keyboard-tabs'
import { createVisibleInterval } from './lib/visible-interval'
import { scenarioDetails } from './data/scenarios'
import type { ArtifactTab } from './data/scenarios'
import { LiveIntelSection } from './components/LiveIntelSection'
import './App.css'

type Severity = 'critical' | 'high' | 'medium' | 'low'

type Alert = {
  id: keyof typeof scenarioDetails
  time: string
  title: string
  severity: Severity
  region: string
  actor: string
  vector: string
  asset: string
  technique: string
  status: string
}

const alerts: Alert[] = [
  {
    id: 'A78-4319',
    time: '14:27:11',
    title: 'Ransomware activity detected',
    severity: 'critical',
    region: 'EU',
    actor: 'Unknown TA505-aligned cluster',
    vector: 'Exploit / Initial access',
    asset: 'FIN-APP-01',
    technique: 'T1486 Data Encrypted for Impact',
    status: 'Isolation approval pending',
  },
  {
    id: 'B16-9012',
    time: '14:26:58',
    title: 'Multiple failed SSH attempts',
    severity: 'high',
    region: 'NA',
    actor: 'APT28 infrastructure',
    vector: 'Credential access',
    asset: 'EDGE-GW-04',
    technique: 'T1110 Brute Force',
    status: 'Access review pending',
  },
  {
    id: 'C93-1204',
    time: '14:26:41',
    title: 'Command and control beacon',
    severity: 'high',
    region: 'APAC',
    actor: 'Lazarus relay node',
    vector: 'C2 / HTTPS tunnel',
    asset: 'HR-WKS-17',
    technique: 'T1071.001 Web Protocols',
    status: 'Beacon review pending',
  },
  {
    id: 'D44-6059',
    time: '14:25:38',
    title: 'Privilege escalation attempt',
    severity: 'medium',
    region: 'EU',
    actor: 'Sandworm pattern match',
    vector: 'Local service abuse',
    asset: 'ENG-BUILD-02',
    technique: 'T1068 Exploitation for Privilege Escalation',
    status: 'Privilege validation pending',
  },
  {
    id: 'E09-7742',
    time: '14:24:59',
    title: 'Policy violation on cloud bucket',
    severity: 'low',
    region: 'NA',
    actor: 'Configuration drift',
    vector: 'Public exposure',
    asset: 'S3-LOG-ARCHIVE',
    technique: 'T1530 Data from Cloud Storage',
    status: 'Policy approval pending',
  },
]

const threatActors = [
  { name: 'APT28', origin: 'RUS', count: '1,284', delta: '+37%' },
  { name: 'APT41', origin: 'CHN', count: '1,021', delta: '+24%' },
  { name: 'Lazarus Group', origin: 'PRK', count: '892', delta: '+18%' },
  { name: 'Sandworm', origin: 'RUS', count: '776', delta: '+11%' },
  { name: 'TA505', origin: 'UNK', count: '687', delta: '+29%' },
]

const packetRows = [
  ['TCP', '192.0.2.42', '10.23.44.17', 'PSH', 'len=517'],
  ['DNS', '10.23.44.17', 'update-service.example', 'A?', 'blocked'],
  ['TLS', '203.0.113.9', '10.23.44.17', 'CLIENT HELLO', 'sni redacted'],
  ['HTTP', '10.23.44.17', '198.51.100.42', 'GET', '/payload denied'],
  ['TCP', '198.51.100.23', '10.23.44.17', 'RST', 'policy match'],
  ['UDP', '172.16.8.14', '10.0.4.21', 'DNS', 'sinkhole'],
]

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

function useProfessionalReveal() {
  useEffect(() => {
    const elements = document.querySelectorAll<HTMLElement>('.reveal, .panel, .case-row, .skills-grid article')
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
      elements.forEach((element) => element.classList.add('is-visible'))
      return
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible')
          observer.unobserve(entry.target)
        }
      })
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 })
    elements.forEach((element, index) => {
      element.style.setProperty('--reveal-index', String(index % 6))
      observer.observe(element)
    })
    return () => observer.disconnect()
  }, [])
}

function App() {
  useProfessionalReveal()

  const [selectedSeverity, setSelectedSeverity] = useState<'all' | Severity>('all')
  const [selectedAlertId, setSelectedAlertId] = useState(alerts[0].id)
  const [tick, setTick] = useState(9503)
  const [simulationRunning, setSimulationRunning] = useState(false)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle')
  const copyRequest = useRef(0)
  const intel = useLiveIntel()

  useEffect(() => {
    if (!simulationRunning) return
    return createVisibleInterval(() => {
      setTick((current) => current + 7)
    }, 2600, document)
  }, [simulationRunning])

  useEffect(() => {
    return () => { copyRequest.current += 1 }
  }, [])

  useEffect(() => {
    if (copyStatus !== 'copied') return
    const timer = window.setTimeout(() => setCopyStatus('idle'), 2400)
    return () => window.clearTimeout(timer)
  }, [copyStatus])

  const filteredAlerts = selectedSeverity === 'all' ? alerts : alerts.filter((alert) => alert.severity === selectedSeverity)

  const selectedAlert =
    alerts.find((alert) => alert.id === selectedAlertId) ?? filteredAlerts[0] ?? alerts[0]

  function selectAlert(id: Alert['id']) {
    copyRequest.current += 1
    setCopyStatus('idle')
    setSelectedAlertId(id)
  }

  function handleSeverityChange(nextSeverity: 'all' | Severity) {
    setSelectedSeverity(nextSeverity)
    const nextAlert =
      nextSeverity === 'all'
        ? alerts[0]
        : alerts.find((alert) => alert.severity === nextSeverity) ?? alerts[0]
    selectAlert(nextAlert.id)
  }

  async function copyBrief() {
    const request = ++copyRequest.current
    setCopyStatus('copying')
    const scenario = scenarioDetails[selectedAlert.id]
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
    <div className={`site-shell${simulationRunning ? '' : ' simulation-paused'}`}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <Navigation state={intel} />
      <main id="main-content" tabIndex={-1}>
        <Hero tick={tick} state={intel} />
        <LiveIntelSection liveIntel={intel.data} state={intel} onRefresh={intel.refresh} />
        <ThreatOperations
          tick={tick}
          selectedSeverity={selectedSeverity}
          selectedAlert={selectedAlert}
          filteredAlerts={filteredAlerts}
          onSeverityChange={handleSeverityChange}
          onSelectAlert={selectAlert}
          onCopyBrief={copyBrief}
          copyStatus={copyStatus}
          simulationRunning={simulationRunning}
          onToggleSimulation={() => setSimulationRunning((running) => !running)}
        />
        <IncidentResponse selectedAlert={selectedAlert} />
        <CaseStudies />
        <SkillMatrix />
      </main>
      <Footer />
    </div>
  )
}

function Navigation({ state }: { state: LiveIntelState }) {
  const [active, setActive] = useState('top')
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) setActive(entry.target.id)
    }, { rootMargin: '-125px 0px -55% 0px', threshold: 0 })
    document.querySelectorAll('main > section[id]').forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [])
  const status = !state.isOnline ? 'Offline / saved data' : state.isRefreshing ? 'Checking public feeds' : state.status === 'live' ? 'Public feeds connected' : state.status === 'connecting' ? 'Connecting to sources' : 'Feeds need attention'
  return (
    <header className="nav-frame" aria-label="Primary navigation">
      <a className="brand" href="#top" aria-label="Cyber Intelligence Lab home"><span className="brand-mark">CIL<span className="brand-period">.</span></span><span>Cyber Intelligence Lab</span></a>
      <nav className="nav-links" aria-label="Primary navigation">
        {[['live-intel', 'Live intel'], ['operations', 'Operations'], ['response', 'Response'], ['cases', 'Cases'], ['skills', 'Skills']].map(([id, label]) => <a key={id} href={`#${id}`} aria-current={active === id ? 'location' : undefined}>{label}</a>)}
      </nav>
      <a href="#live-intel" className={`nav-status ${!state.isOnline ? 'offline' : state.status}`}><span className="status-dot" aria-hidden="true" />{status}</a>
    </header>
  )
}

function Hero({ tick, state }: { tick: number; state: LiveIntelState }) {
  const available = state.isOnline && (state.status === 'live' || state.status === 'partial')
    ? state.data?.sources.filter((source) => source.status === 'ok').length ?? 0 : null
  const count = state.data ? state.data.kev.length + state.data.news.length : null
  return (
    <section className="hero-section section-grid" id="top">
      <div className="hero-copy reveal">
        <p className="kicker">Independent security engineering</p>
        <h1><span>Cyber</span>{' '}<span>Intelligence</span>{' '}<span>Lab</span></h1>
        <p className="hero-subtitle">Read the signals.{' '}<br /><strong>Understand the response.</strong></p>
        <p className="hero-description">A hands-on workspace connecting real public advisories with five explorable incident scenarios. Built for curious minds, not just security teams.</p>
        <div className="hero-actions" role="group" aria-label="Primary actions">
          <a className="button button-primary" href="#live-intel"><span>Explore live intelligence</span><span className="button-glyph" aria-hidden="true">↗</span></a>
          <a className="button button-secondary" href="#operations"><span>Launch console</span><span className="button-glyph" aria-hidden="true">↗</span></a>
        </div>
        <dl className="signal-strip" aria-label="Workspace overview">
          <div><dt>{available ?? '—'}<span>/2</span></dt><dd>Verified public feeds</dd></div>
          <div><dt>{count ?? '—'}</dt><dd>{state.status === 'live' && state.isOnline ? 'Retrieved records' : 'Saved records'}</dd></div>
          <div><dt>05</dt><dd>Practice scenarios</dd></div>
        </dl>
        <p className="hero-disclosure">Read-only public intelligence. Simulated incident response. No network monitoring or security actions.</p>
      </div>
      <div className="hero-console reveal delay-1" role="group" aria-label="Illustrative topology and public-source preview">
        <div className="console-topline"><span><i aria-hidden="true" /> ANALYST WORKSPACE</span><span>PUBLIC OSINT + SIMULATION</span></div>
        <ThreatMap compact={false} tick={tick} />
        <div className="hero-brief">
          <div className="brief-heading"><span>From the current snapshot</span><a href="#live-intel">Explore feeds <span aria-hidden="true">↗</span></a></div>
          <div className="brief-items">
            <article><span>CISA / {state.data?.kev[0]?.id ?? 'Awaiting source'}</span><p>{state.data?.kev[0]?.title ?? 'Public vulnerability records appear after the first successful check.'}</p></article>
            <article><span>Cyber news / public discussion</span><p>{state.data?.news[0]?.title ?? 'Recent cybersecurity discussions appear when the news source is available.'}</p></article>
          </div>
          {state.status !== 'live' && <p className="brief-caveat">{!state.isOnline ? 'Offline. Saved records may be out of date.' : state.data ? 'Some records may be out of date. Check source health below.' : 'Connecting to the public feeds.'}</p>}
        </div>
      </div>
    </section>
  )
}

function ThreatOperations({
  tick,
  selectedSeverity,
  selectedAlert,
  filteredAlerts,
  onSeverityChange,
  onSelectAlert,
  onCopyBrief,
  copyStatus,
  simulationRunning,
  onToggleSimulation,
}: {
  tick: number
  selectedSeverity: 'all' | Severity
  selectedAlert: Alert
  filteredAlerts: Alert[]
  onSeverityChange: (severity: 'all' | Severity) => void
  onSelectAlert: (id: Alert['id']) => void
  onCopyBrief: () => void
  copyStatus: 'idle' | 'copying' | 'copied' | 'error'
  simulationRunning: boolean
  onToggleSimulation: () => void
}) {
  const scenario = scenarioDetails[selectedAlert.id]
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

      <div className="workspace-note"><span className="mode-tag">Simulation workspace</span><p>1. Select an incident <span aria-hidden="true">/</span> 2. Review evidence <span aria-hidden="true">/</span> 3. Open its response</p></div>
      <div className="ops-grid reveal delay-1">
        <aside className="panel actor-panel">
          <div className="panel-title">Example actor rankings</div>
          <div className="actor-list">
            {threatActors.map((actor, index) => (
              <div className="actor-row" key={actor.name}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{actor.name}</strong>
                <small>{actor.origin}</small>
                <data>{actor.count}</data>
                <em>{actor.delta}</em>
              </div>
            ))}
          </div>
        </aside>

        <div className="panel map-panel">
          <div className="panel-heading">
            <div>
              <div className="panel-title">Simulated threat map</div>
              <small>{simulationRunning ? 'Demo animation running' : 'Demo animation paused'} — no traffic is monitored</small>
            </div>
            <div className="panel-controls" role="group" aria-label="Simulation controls">
              <button type="button" aria-pressed={simulationRunning} onClick={onToggleSimulation}>
                {simulationRunning ? 'Pause simulation' : 'Start simulation'}
              </button>
            </div>
          </div>
          <ThreatMap compact tick={tick} />
        </div>

        <aside className="panel alert-panel" aria-live="polite">
          <div className="panel-heading">
            <div>
              <div className="panel-title">Selected demo alert</div>
              <small>#{selectedAlert.id}</small>
            </div>
            <span className={`severity-badge ${selectedAlert.severity}`}>
              {severityLabel(selectedAlert.severity)}
            </span>
          </div>
          <h3>{selectedAlert.title}</h3>
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
            <a className="button button-primary slim" href="#response">
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
          <div className="queue-table">
            {filteredAlerts.map((alert) => (
              <button
                className={selectedAlert.id === alert.id ? 'queue-row active' : 'queue-row'}
                key={alert.id}
                type="button"
                aria-pressed={selectedAlert.id === alert.id}
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
          <PacketStream />
        </div>

        <div className="panel vector-panel">
          <div className="panel-title">Example exploit vectors</div>
          {[
            ['Initial access', 28],
            ['Public-facing app', 22],
            ['Phishing', 18],
            ['Valid accounts', 11],
            ['Ransomware', 9],
            ['Malware download', 7],
            ['Other', 5],
          ].map(([label, value]) => (
            <div className="bar-row" key={label}>
              <span>{label}</span>
              <div className="bar-track">
                <i style={{ width: `${value}%` }}></i>
              </div>
              <data>{value}%</data>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function ThreatMap({ compact, tick }: { compact: boolean; tick: number }) {
  return (
    <div className={compact ? 'threat-map compact' : 'threat-map'}>
      <div className="map-visual">
        <div className="map-caption"><span>Illustrative topology</span><span>Not live traffic</span></div>
        <div className="map-grid"></div>
        <svg className="arc-layer" viewBox="0 0 1000 520" aria-hidden="true">
          <path d="M128 222 C 260 54, 480 60, 610 204" />
          <path d="M206 316 C 395 168, 585 160, 806 238" />
          <path d="M628 202 C 718 88, 858 106, 920 198" />
          <path d="M354 198 C 468 106, 694 92, 842 330" />
          <path d="M122 278 C 292 358, 528 402, 886 354" />
        </svg>
        {[
          ['na', 'N. America', '1,842'],
          ['eu', 'Europe', '2,317'],
          ['asia', 'Asia', '3,961'],
          ['sa', 'S. America', '672'],
          ['af', 'Africa', '418'],
          ['oc', 'Oceania', '293'],
        ].map(([className, label, value], index) => (
          <div className={`map-node ${className}`} key={className}>
            <span></span>
            <strong>{label}</strong>
            <data>{(Number(value.replaceAll(',', '')) + (index === 0 ? tick - 9503 : 0)).toLocaleString()}</data>
          </div>
        ))}
      </div>
      <div className="map-readout">
        <span>Demo events</span>
        <data>{tick.toLocaleString()}</data>
      </div>
    </div>
  )
}

function PacketStream({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'packet-stream compact' : 'packet-stream'}>
      <div className="panel-title">Example packet stream</div>
      {packetRows.map(([protocol, src, dest, flag, note], index) => (
        <p key={`${src}-${dest}-${index}`}>
          <time>14:27:{String(12 - index).padStart(2, '0')}</time>
          <span>{protocol}</span>
          <strong>{src}</strong>
          <span>→</span>
          <strong>{dest}</strong>
          <em>{flag}</em>
          <small>{note}</small>
        </p>
      ))}
    </div>
  )
}

function IncidentResponse({ selectedAlert }: { selectedAlert: Alert }) {
  const [activeArtifactTab, setActiveArtifactTab] = useState<ArtifactTab>('file')
  const scenario = scenarioDetails[selectedAlert.id]
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
    <section className="response-section" id="response">
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
          <div className="timeline">
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
              <small>Static template / not AI-generated analysis</small>
            </div>
            <small>Demo data</small>
          </div>
          <p className="scenario-summary">{scenario.summary}</p>
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
          <div className="forensic-content" id="artifact-panel" aria-labelledby={`artifact-tab-${activeArtifactTab}`} tabIndex={0} key={activeArtifactTab} role="tabpanel">
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
