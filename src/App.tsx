import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { LiveIntelPayload } from '../shared/live-intel'
import type { LiveIntelState } from './lib/live-intel'
import { emptyFeedMessage } from './lib/live-intel'
import { useLiveIntel } from './hooks/useLiveIntel'
import { nextTab } from './lib/keyboard-tabs'
import { createVisibleInterval } from './lib/visible-interval'
import './App.css'

type Severity = 'critical' | 'high' | 'medium' | 'low'

type Alert = {
  id: string
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
    status: 'Containment ready',
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
    status: 'MFA reset queued',
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
    status: 'Host isolation active',
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
    status: 'Evidence captured',
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
    status: 'Remediation assigned',
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

const timeline = [
  {
    stage: 'Recon',
    time: '10:14:22',
    tone: 'critical',
    copy: 'External reconnaissance detected from suspicious ranges. Enumeration signatures matched.',
  },
  {
    stage: 'Initial access',
    time: '11:03:41',
    tone: 'critical',
    copy: 'Phishing delivery reached a test mailbox. Attachment execution blocked by policy.',
  },
  {
    stage: 'Lateral movement',
    time: '12:27:19',
    tone: 'medium',
    copy: 'Suspicious SMB activity and credential access attempts observed across three hosts.',
  },
  {
    stage: 'Containment',
    time: '14:52:03',
    tone: 'low',
    copy: 'Affected systems isolated. Network controls updated and credential reset initiated.',
  },
  {
    stage: 'Recovery',
    time: '16:18:47',
    tone: 'success',
    copy: 'Validation in progress. Telemetry remains clean across the monitored segment.',
  },
]

const techniques = [
  ['T1566.001', 'Spearphishing Attachment', 'Initial Access'],
  ['T1003', 'OS Credential Dumping', 'Credential Access'],
  ['T1021', 'Remote Services', 'Lateral Movement'],
  ['T1070', 'Indicator Removal on Host', 'Defense Evasion'],
  ['T1041', 'Exfiltration Over C2 Channel', 'Exfiltration'],
]

type ArtifactTab = 'file' | 'network' | 'process' | 'registry'

const artifactTabs: Record<
  ArtifactTab,
  {
    label: string
    fields: Array<[string, string]>
    checklist: Array<[string, boolean]>
  }
> = {
  file: {
    label: 'File',
    fields: [
      ['File name', 'invoice_7784.docm'],
      ['SHA256', '3f2a4ec...f67890'],
      ['Reputation', 'Malicious / sandbox match'],
      ['Command line', '[encoded payload redacted]'],
    ],
    checklist: [
      ['Isolate affected hosts', true],
      ['Terminate malicious processes', true],
      ['Revoke compromised credentials', true],
      ['Block IOCs at perimeter', false],
      ['Validate system integrity', false],
    ],
  },
  network: {
    label: 'Network',
    fields: [
      ['Source IP', '192.0.2.42'],
      ['Destination', '10.23.44.17:49712'],
      ['Protocol', 'HTTPS / suspicious beacon'],
      ['Disposition', 'Blocked at perimeter'],
    ],
    checklist: [
      ['Sinkhole destination domain', true],
      ['Push perimeter block rule', true],
      ['Extract JA3 fingerprint', true],
      ['Hunt for matching SNI', false],
      ['Notify network owner', false],
    ],
  },
  process: {
    label: 'Process',
    fields: [
      ['Parent', 'WINWORD.EXE'],
      ['Child', 'powershell.exe -nop -w hidden'],
      ['PID chain', '3128 / 4188 / 5220'],
      ['Confidence', 'High-risk execution tree'],
    ],
    checklist: [
      ['Kill child process tree', true],
      ['Capture memory snapshot', true],
      ['Preserve parent document', true],
      ['Review persistence keys', false],
      ['Add EDR detection logic', false],
    ],
  },
  registry: {
    label: 'Registry',
    fields: [
      ['Hive', 'HKCU\\Software\\Microsoft\\Windows\\Run'],
      ['Value', 'UpdaterService'],
      ['Data', 'rundll32 updater.dll,Start'],
      ['Action', 'Queued for removal'],
    ],
    checklist: [
      ['Export registry evidence', true],
      ['Remove persistence value', true],
      ['Search peer endpoints', false],
      ['Document change window', false],
      ['Validate reboot state', false],
    ],
  },
}

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
  const [tick, setTick] = useState(7523)
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

  function selectAlert(id: string) {
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
    const brief = `SIMULATED INCIDENT (not live telemetry) | ${selectedAlert.id} | ${selectedAlert.title} | ${selectedAlert.severity} | ${selectedAlert.technique}`
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
      <Navigation />
      <main id="main-content" tabIndex={-1}>
        <Hero tick={tick} />
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
        <LiveIntelSection liveIntel={intel.data} state={intel} onRefresh={intel.refresh} />
        <IncidentResponse selectedAlert={selectedAlert} />
        <CaseStudies />
        <SkillMatrix />
      </main>
      <Footer />
    </div>
  )
}

function Navigation() {
  return (
    <header className="nav-frame" aria-label="Primary navigation">
      <a className="brand" href="#top" aria-label="Cyber Intelligence Lab home">
        <span className="brand-mark">CIL</span>
        <span>Cyber Intelligence Lab</span>
      </a>
      <nav className="nav-links" aria-label="Primary navigation">
        <a href="#operations">Operations</a>
        <a href="#live-intel">Live Intel</a>
        <a href="#response">Response</a>
        <a href="#cases">Cases</a>
        <a href="#skills">Skills</a>
      </nav>
      <div className="nav-status" aria-label="Lab status">
        <span className="status-dot" aria-hidden="true"></span>
        Demo console / public OSINT
      </div>
    </header>
  )
}

function Hero({ tick }: { tick: number }) {
  return (
    <section className="hero-section section-grid" id="top">
      <div className="hero-copy reveal">
        <p className="kicker">Defensive security portfolio</p>
        <h1>Cyber Intelligence Lab</h1>
        <p className="hero-subtitle">
          Explore simulated incident workflows alongside real public advisories. This lab does not monitor networks, detect attacks, or take security actions.
        </p>
        <div className="hero-actions" aria-label="Primary actions">
          <a className="button button-primary" href="#operations">
            <span>Launch console</span>
            <span className="button-glyph" aria-hidden="true">
              →
            </span>
          </a>
          <a className="button button-secondary" href="#cases">
            <span>View threat lab</span>
            <span className="button-glyph" aria-hidden="true">
              ↗
            </span>
          </a>
        </div>
        <dl className="signal-strip" aria-label="Illustrative demo metrics">
          <div>
            <dt>Demo</dt>
            <dd>Simulated telemetry</dd>
          </div>
          <div>
            <dt>137</dt>
            <dd>Example incident signals</dd>
          </div>
          <div>
            <dt>{tick.toLocaleString()}</dt>
            <dd>Simulated events</dd>
          </div>
        </dl>
      </div>

      <div className="hero-console reveal delay-1" aria-label="Simulated global threat console preview">
        <ThreatMap compact={false} tick={tick} />
        <div className="hero-console-bottom">
          <PacketStream compact />
          <div className="system-log">
            <div className="panel-title">Example log // SOC</div>
            {[
              ['ALERT', 'Suspicious lateral movement detected'],
              ['INFO', 'Example IOC match in demo feed'],
              ['WARN', 'Multiple failed login attempts'],
              ['SUCCESS', 'Endpoint isolated: 10.0.4.21'],
              ['INFO', 'Forensic artifact collection queued'],
            ].map(([label, copy]) => (
              <p key={copy}>
                <span className={`log-label ${label.toLowerCase()}`}>{label}</span>
                {copy}
              </p>
            ))}
          </div>
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
  onSelectAlert: (id: string) => void
  onCopyBrief: () => void
  copyStatus: 'idle' | 'copying' | 'copied' | 'error'
  simulationRunning: boolean
  onToggleSimulation: () => void
}) {
  const severityOptions: Array<'all' | Severity> = ['all', 'critical', 'high', 'medium', 'low']

  return (
    <section className="operations-section" id="operations">
      <div className="section-header reveal">
        <span>02.</span>
        <div>
          <p className="kicker">Threat operations / simulation</p>
          <h2>A practice console, not live monitoring.</h2>
        </div>
        <p className="quote">All actors, counts and incidents below are illustrative.</p>
      </div>

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
              <small>Simulated events: {tick.toLocaleString()}</small>
            </div>
            <div className="panel-controls" aria-label="Simulation controls">
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
              <dt>Status</dt>
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
            {[
              ['Hash', '3f2a...9e7c'],
              ['Domain', 'update-service[.]example'],
              ['URL', 'hxxp://192.0.2.42/payload'],
              ['IP', '192.0.2.42'],
              ['Mutex', 'Global\\RHUB_7A3F'],
            ].map(([label, value]) => (
              <div className="ioc-row" key={label}>
                <span>{label}</span>
                <code>{value}</code>
              </div>
            ))}
          </div>
          <div className="containment-mini">
            <div className="panel-title">Example containment status</div>
            {['Isolate host', 'Reset credentials', 'Block perimeter IOCs'].map((item) => (
              <p className="checklist-item" key={item}>
                <span className="checklist-state">Done</span>
                <span>{item}</span>
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
            <div className="severity-filter" aria-label="Threat severity filter">
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
                <small>{alert.region}</small>
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
          ].map(([label, value]) => (
            <div className="bar-row" key={label}>
              <span>{label}</span>
              <div className="bar-track">
                <i style={{ width: `${Number(value) * 2.7}%` }}></i>
              </div>
              <data>{value}%</data>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function LiveIntelSection({
  liveIntel,
  state,
  onRefresh,
}: {
  liveIntel: LiveIntelPayload | null
  state: LiveIntelState
  onRefresh: () => void
}) {
  const generatedAt = liveIntel?.generatedAt
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'medium',
      }).format(new Date(liveIntel.generatedAt))
    : 'Waiting for first sync'

  const nextPollSeconds = Math.round(state.pollAfterMs / 1000)
  const kevItems = liveIntel?.kev.slice(0, 5) ?? []
  const newsItems = liveIntel?.news.slice(0, 5) ?? []
  const sourceCount = liveIntel?.sources.filter((source) => source.status === 'ok').length ?? 0
  const statusLabels = { connecting: 'Connecting', live: 'Sources current', partial: 'Partial sync', stale: 'Stale data', error: 'Source error' }
  const statusMessage = state.error ?? (state.status === 'partial'
    ? 'Some sources could not refresh. Check source health before using these records.'
    : state.status === 'stale' ? 'Showing previously retrieved records. They may be out of date.'
    : state.status === 'error' ? 'No reliable source data is available. An automatic retry is scheduled.' : '')

  return (
    <section className="live-intel-section" id="live-intel">
      <div className="section-header reveal">
        <span>NET.</span>
        <div>
          <p className="kicker">Internet OSINT sync</p>
          <h2>Real public cyber signals, refreshed automatically.</h2>
        </div>
        <p className="quote">Open sources. Defensive awareness. Responsible polling.</p>
      </div>

      <div className="live-intel-grid reveal delay-1">
        <article className="panel live-status-panel">
          <div className="panel-heading">
            <div>
              <div className="panel-title">Automation status</div>
              <small>Client polling / server-side source cache</small>
            </div>
            <span className={`live-status-badge ${state.status}`} role="status">
              {state.isRefreshing ? 'Refreshing' : statusLabels[state.status]}
            </span>
          </div>
          {statusMessage && <p className="feed-notice" role="status">{statusMessage}</p>}
          <dl className="automation-list">
            <div>
              <dt>Snapshot generated</dt>
              <dd>{generatedAt}</dd>
            </div>
            <div>
              <dt>Automatic check interval</dt>
              <dd>{nextPollSeconds} seconds after each response</dd>
            </div>
            <div>
              <dt>{state.error ? 'Previously healthy sources' : 'Healthy sources'}</dt>
              <dd>
                {sourceCount}/{liveIntel?.sources.length ?? 2}
              </dd>
            </div>
            <div>
              <dt>Scope</dt>
              <dd>Public cyber advisories and news search, not private surveillance.</dd>
            </div>
          </dl>
          <button className="button button-primary live-refresh" type="button" onClick={onRefresh} disabled={state.isRefreshing}>
            <span>{state.isRefreshing ? 'Refreshing…' : 'Refresh sources'}</span>
            <span className="button-glyph" aria-hidden="true">
              ↻
            </span>
          </button>
        </article>

        <article className="panel osint-feed-panel">
          <div className="panel-heading">
            <div>
              <div className="panel-title">CISA exploited vulnerabilities</div>
              <small>Known Exploited Vulnerabilities catalog</small>
            </div>
            <data>{kevItems.length}</data>
          </div>
          <div className="osint-list">
            {kevItems.length ? (
              kevItems.map((item) => (
                <a href={item.url} key={item.id} rel="noreferrer" target="_blank">
                  <span>{item.dateAdded}</span>
                  <strong>{item.id}</strong>
                  <p>{item.title}</p>
                  <small>
                    {item.vendor} / {item.product} / ransomware use: {item.ransomwareUse}
                  </small>
                  <em>Open CISA record <span className="sr-only">(opens in a new tab)</span></em>
                </a>
              ))
            ) : (
              <p className="empty-feed">{emptyFeedMessage('CISA', liveIntel?.sources[0]?.status, state.isRefreshing, Boolean(state.error))}</p>
            )}
          </div>
        </article>

        <article className="panel osint-feed-panel">
          <div className="panel-heading">
            <div>
              <div className="panel-title">Cyber news pulse</div>
              <small>Recent public web stories via Hacker News Algolia</small>
            </div>
            <data>{newsItems.length}</data>
          </div>
          <div className="osint-list">
            {newsItems.length ? (
              newsItems.map((item) => (
                <a href={item.url} key={item.id} rel="noreferrer" target="_blank">
                  <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                  <strong>{item.source}</strong>
                  <p>{item.title}</p>
                  <small>
                    by {item.author} / {item.points} points
                  </small>
                  <em>Open discussion record <span className="sr-only">(opens in a new tab)</span></em>
                </a>
              ))
            ) : (
              <p className="empty-feed">{emptyFeedMessage('cyber news', liveIntel?.sources[1]?.status, state.isRefreshing, Boolean(state.error))}</p>
            )}
          </div>
        </article>

        <article className="panel source-health-panel">
          <div className="panel-title">Source health</div>
          {(liveIntel?.sources ?? []).map((source) => (
            <div className="source-row" key={source.name}>
              <span className={state.error ? 'stale' : source.status}>{state.error ? 'unverified' : source.status}</span>
              <strong>{source.name}</strong>
              <small>
                {source.message ?? `${source.count} records received`}
                {source.lastSuccessAt && ` · Last successful refresh: ${new Date(source.lastSuccessAt).toLocaleString()}`}
              </small>
            </div>
          ))}
          {!liveIntel && <p className="empty-feed">{state.isRefreshing ? 'Connecting to public sources.' : 'Source health is unavailable until a request succeeds.'}</p>}
        </article>
      </div>
    </section>
  )
}

function ThreatMap({ compact, tick }: { compact: boolean; tick: number }) {
  return (
    <div className={compact ? 'threat-map compact' : 'threat-map'}>
      <div className="map-visual">
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
        ].map(([className, label, value]) => (
          <div className={`map-node ${className}`} key={className}>
            <span></span>
            <strong>{label}</strong>
            <data>{value}</data>
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
  const activeArtifact = artifactTabs[activeArtifactTab]
  const tabs = Object.keys(artifactTabs) as ArtifactTab[]

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
          <h2>Explore a sample response workflow.</h2>
        </div>
        <p className="quote">Static examples. No AI service or endpoint actions are connected.</p>
      </div>

      <div className="response-grid reveal delay-1">
        <div className="panel timeline-panel">
          <div className="panel-title">Example incident timeline</div>
          <div className="timeline">
            {timeline.map((item) => (
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
            <small>3 hosts isolated / 12 indicators / 0 confirmed data exposure</small>
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
          <div className="risk-grid">
            <div>
              <span>Example risk score</span>
              <strong>87</strong>
              <small>/ 100</small>
            </div>
            <div>
              <span>Selected scenario</span>
              <strong>{selectedAlert.title}</strong>
              <small>{selectedAlert.technique}</small>
            </div>
            <div>
              <span>Kill-chain phase</span>
              <strong>Lateral movement</strong>
              <small>Confidence high</small>
            </div>
          </div>
          <div className="technique-table">
            {techniques.map(([id, name, phase]) => (
              <div key={id}>
                <code>{id}</code>
                <span>{name}</span>
                <small>{phase}</small>
              </div>
            ))}
          </div>
          <div className="actions-list">
            {[
              'Isolate additional affected hosts',
              'Reset compromised user credentials',
              'Block associated IPs and domains',
              'Hunt for related artifacts',
              'Collect memory image for forensic analysis',
            ].map((action, index) => (
              <div key={action}>
                <span>{index + 1}</span>
                <p>{action}</p>
                <strong>{index < 3 ? 'High' : 'Medium'}</strong>
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
                {artifactTabs[tab].label}
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
