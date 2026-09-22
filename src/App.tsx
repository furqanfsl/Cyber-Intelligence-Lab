import { useEffect, useMemo, useState } from 'react'
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

type LiveIntelPayload = {
  generatedAt: string
  pollAfterMs: number
  cacheTtlMs: number
  sources: Array<{
    name: string
    status: 'ok' | 'error'
    count: number
    message?: string
  }>
  kev: Array<{
    id: string
    title: string
    vendor: string
    product: string
    dateAdded: string
    dueDate: string
    ransomwareUse: string
    url: string
  }>
  news: Array<{
    id: string
    title: string
    url: string
    source: string
    author: string
    points: number
    createdAt: string
  }>
}

type LiveIntelStatus = 'connecting' | 'live' | 'error'

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
  ['TCP', '185.199.110.42', '10.23.44.17', 'PSH', 'len=517'],
  ['DNS', '10.23.44.17', 'update-service.net', 'A?', 'blocked'],
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
      'Contained an active ransomware scenario across 1,200 simulated endpoints, isolated lateral movement, and restored service workflow without ransom payment.',
    impact: '> 99%',
    metric: 'threat contained',
    extra: '1,200+ endpoints secured',
    tools: ['CrowdStrike', 'Splunk', 'Velociraptor', 'Wireshark'],
    timeline: '36 hours',
    category: 'Ransomware',
  },
  {
    label: 'Threat hunting / email security',
    title: 'Phishing takedown',
    summary:
      'Tracked and dismantled phishing infrastructure targeting executive teams through IOC clustering, domain evidence, and detection tuning.',
    impact: '> 92%',
    metric: 'malicious traffic reduced',
    extra: '17 domains taken down',
    tools: ['MISP', 'Maltego', 'Proofpoint', 'Python'],
    timeline: '2 weeks',
    category: 'Phishing',
  },
  {
    label: 'Cloud security / attack surface',
    title: 'Cloud misconfiguration hunt',
    summary:
      'Identified critical public exposure patterns across multi-cloud assets and built repeatable checks for over-permissive access paths.',
    impact: '> 70',
    metric: 'risks remediated',
    extra: '0 exposure incidents',
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
      ['Source IP', '185.199.110.42'],
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
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>(
        '.reveal, .panel, .case-row, .skills-grid article, .osint-list a',
      ),
    )

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
          }
        })
      },
      {
        rootMargin: '0px 0px -10% 0px',
        threshold: 0.12,
      },
    )

    elements.forEach((element, index) => {
      element.style.setProperty('--reveal-index', String(index % 6))
      observer.observe(element)
    })

    return () => observer.disconnect()
  })
}

function App() {
  useProfessionalReveal()

  const [selectedSeverity, setSelectedSeverity] = useState<'all' | Severity>('all')
  const [selectedAlertId, setSelectedAlertId] = useState(alerts[0].id)
  const [tick, setTick] = useState(7523)
  const [copied, setCopied] = useState(false)
  const [liveIntel, setLiveIntel] = useState<LiveIntelPayload | null>(null)
  const [liveStatus, setLiveStatus] = useState<LiveIntelStatus>('connecting')
  const [syncPulse, setSyncPulse] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTick((current) => current + Math.floor(Math.random() * 9) + 3)
    }, 2600)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let alive = true
    let timeoutId: number | undefined
    let controller: AbortController | undefined

    async function loadLiveIntel() {
      controller?.abort()
      controller = new AbortController()

      try {
        setLiveStatus((current) => (current === 'live' ? current : 'connecting'))
        const response = await fetch('/api/live-intel', {
          cache: 'no-store',
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`Live intelligence endpoint returned ${response.status}`)
        }

        const payload = (await response.json()) as LiveIntelPayload

        if (!alive) {
          return
        }

        setLiveIntel(payload)
        setLiveStatus('live')
        setSyncPulse((current) => current + 1)
        timeoutId = window.setTimeout(loadLiveIntel, payload.pollAfterMs || 60_000)
      } catch (error) {
        if (!alive || (error instanceof DOMException && error.name === 'AbortError')) {
          return
        }

        setLiveStatus('error')
        timeoutId = window.setTimeout(loadLiveIntel, 90_000)
      }
    }

    loadLiveIntel()

    return () => {
      alive = false
      controller?.abort()
      if (timeoutId) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [])

  const filteredAlerts = useMemo(() => {
    if (selectedSeverity === 'all') {
      return alerts
    }

    return alerts.filter((alert) => alert.severity === selectedSeverity)
  }, [selectedSeverity])

  const selectedAlert =
    alerts.find((alert) => alert.id === selectedAlertId) ?? filteredAlerts[0] ?? alerts[0]

  function handleSeverityChange(nextSeverity: 'all' | Severity) {
    setSelectedSeverity(nextSeverity)
    const nextAlert =
      nextSeverity === 'all'
        ? alerts[0]
        : alerts.find((alert) => alert.severity === nextSeverity) ?? alerts[0]
    setSelectedAlertId(nextAlert.id)
  }

  function copyBrief() {
    const brief = `${selectedAlert.id} | ${selectedAlert.title} | ${selectedAlert.severity} | ${selectedAlert.technique}`
    navigator.clipboard
      ?.writeText(brief)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1800)
      })
      .catch(() => setCopied(false))
  }

  function refreshLiveIntel() {
    setSyncPulse((current) => current + 1)
    setLiveStatus('connecting')
    fetch('/api/live-intel', { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Live intelligence endpoint returned ${response.status}`)
        }

        return response.json() as Promise<LiveIntelPayload>
      })
      .then((payload) => {
        setLiveIntel(payload)
        setLiveStatus('live')
      })
      .catch(() => setLiveStatus('error'))
  }

  return (
    <main className="site-shell">
      <Navigation />
      <Hero tick={tick} />
      <ThreatOperations
        tick={tick}
        selectedSeverity={selectedSeverity}
        selectedAlert={selectedAlert}
        filteredAlerts={filteredAlerts}
        onSeverityChange={handleSeverityChange}
        onSelectAlert={setSelectedAlertId}
        onCopyBrief={copyBrief}
        copied={copied}
      />
      <LiveIntelSection
        liveIntel={liveIntel}
        status={liveStatus}
        syncPulse={syncPulse}
        onRefresh={refreshLiveIntel}
      />
      <IncidentResponse selectedAlert={selectedAlert} />
      <CaseStudies />
      <SkillMatrix />
      <Footer />
    </main>
  )
}

function Navigation() {
  return (
    <header className="nav-frame" aria-label="Primary navigation">
      <a className="brand" href="#top" aria-label="Cyber Intelligence Lab home">
        <span className="brand-mark">CIL</span>
        <span>Cyber Intelligence Lab</span>
      </a>
      <nav className="nav-links">
        <a href="#operations">Operations</a>
        <a href="#live-intel">Live Intel</a>
        <a href="#response">Response</a>
        <a href="#cases">Cases</a>
        <a href="#skills">Skills</a>
      </nav>
      <div className="nav-status" aria-label="Lab status">
        <span className="status-dot"></span>
        All systems operational
      </div>
    </header>
  )
}

function Hero({ tick }: { tick: number }) {
  return (
    <section className="hero-section section-grid" id="top">
      <div className="hero-copy reveal">
        <p className="kicker">Global threat observatory</p>
        <h1>Cyber Intelligence Lab</h1>
        <p className="hero-subtitle">
          Threat detection, incident response, and real-world intelligence built into one
          cinematic security operations experience.
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
        <dl className="signal-strip" aria-label="Cyber lab metrics">
          <div>
            <dt>24/7</dt>
            <dd>Threat monitoring</dd>
          </div>
          <div>
            <dt>137</dt>
            <dd>Open incident signals</dd>
          </div>
          <div>
            <dt>{tick.toLocaleString()}</dt>
            <dd>Live attack events</dd>
          </div>
        </dl>
      </div>

      <div className="hero-console reveal delay-1" aria-label="Live global threat console preview">
        <ThreatMap compact={false} tick={tick} />
        <div className="hero-console-bottom">
          <PacketStream compact />
          <div className="system-log">
            <div className="panel-title">System log // SOC</div>
            {[
              ['ALERT', 'Suspicious lateral movement detected'],
              ['INFO', 'New IOC matched against global feed'],
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
  copied,
}: {
  tick: number
  selectedSeverity: 'all' | Severity
  selectedAlert: Alert
  filteredAlerts: Alert[]
  onSeverityChange: (severity: 'all' | Severity) => void
  onSelectAlert: (id: string) => void
  onCopyBrief: () => void
  copied: boolean
}) {
  const severityOptions: Array<'all' | Severity> = ['all', 'critical', 'high', 'medium', 'low']

  return (
    <section className="operations-section" id="operations">
      <div className="section-header reveal">
        <span>02.</span>
        <div>
          <p className="kicker">Threat operations</p>
          <h2>Live global threat intelligence. Real-world impact.</h2>
        </div>
        <p className="quote">Intelligence turns noise into advantage.</p>
      </div>

      <div className="ops-grid reveal delay-1">
        <aside className="panel actor-panel">
          <div className="panel-title">Top threat actors</div>
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
              <div className="panel-title">Global threat map</div>
              <small>Live attacks: {tick.toLocaleString()}</small>
            </div>
            <div className="panel-controls" aria-label="Map controls">
              <button type="button">Live</button>
              <button type="button">Last 24h</button>
              <button type="button">All threats</button>
            </div>
          </div>
          <ThreatMap compact tick={tick} />
        </div>

        <aside className="panel alert-panel" aria-live="polite">
          <div className="panel-heading">
            <div>
              <div className="panel-title">Selected alert</div>
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
            <button className="button button-primary slim" type="button">
              Take action
            </button>
            <button className="button button-secondary slim" type="button" onClick={onCopyBrief}>
              {copied ? 'Brief copied' : 'Copy brief'}
            </button>
          </div>
          <div className="related-iocs">
            <div className="panel-title">Related IOCs</div>
            {[
              ['Hash', '3f2a...9e7c'],
              ['Domain', 'update-service[.]net'],
              ['URL', 'hxxp://185.199.110.42/payload'],
              ['IP', '185.199.110.42'],
              ['Mutex', 'Global\\RHUB_7A3F'],
            ].map(([label, value]) => (
              <div className="ioc-row" key={label}>
                <span>{label}</span>
                <code>{value}</code>
              </div>
            ))}
          </div>
          <div className="containment-mini">
            <div className="panel-title">Immediate containment</div>
            {['Isolate host', 'Reset credentials', 'Block perimeter IOCs'].map((item) => (
              <label key={item}>
                <input type="checkbox" checked readOnly />
                <span>{item}</span>
              </label>
            ))}
          </div>
        </aside>

        <div className="panel queue-panel">
          <div className="panel-heading">
            <div>
              <div className="panel-title">Live incident queue</div>
              <small>{filteredAlerts.length} filtered signals</small>
            </div>
            <div className="severity-filter" aria-label="Threat severity filter">
              {severityOptions.map((severity) => (
                <button
                  className={selectedSeverity === severity ? 'active' : ''}
                  key={severity}
                  type="button"
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
                onClick={() => onSelectAlert(alert.id)}
              >
                <time>{alert.time}</time>
                <span className={`severity-dot ${alert.severity}`}></span>
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
          <div className="panel-title">Top exploit vectors</div>
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
  status,
  syncPulse,
  onRefresh,
}: {
  liveIntel: LiveIntelPayload | null
  status: LiveIntelStatus
  syncPulse: number
  onRefresh: () => void
}) {
  const generatedAt = liveIntel?.generatedAt
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'medium',
      }).format(new Date(liveIntel.generatedAt))
    : 'Waiting for first sync'

  const nextPollSeconds = Math.round((liveIntel?.pollAfterMs ?? 60_000) / 1000)
  const kevItems = liveIntel?.kev.slice(0, 5) ?? []
  const newsItems = liveIntel?.news.slice(0, 5) ?? []
  const sourceCount = liveIntel?.sources.filter((source) => source.status === 'ok').length ?? 0

  return (
    <section className="live-intel-section" id="live-intel" aria-live="polite">
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
            <span className={`live-status-badge ${status}`} key={syncPulse}>
              {status === 'live' ? 'Live sync' : status === 'error' ? 'Source error' : 'Connecting'}
            </span>
          </div>
          <dl className="automation-list">
            <div>
              <dt>Last sync</dt>
              <dd>{generatedAt}</dd>
            </div>
            <div>
              <dt>Next automatic check</dt>
              <dd>{nextPollSeconds} seconds</dd>
            </div>
            <div>
              <dt>Healthy sources</dt>
              <dd>
                {sourceCount}/{liveIntel?.sources.length ?? 2}
              </dd>
            </div>
            <div>
              <dt>Scope</dt>
              <dd>Public cyber advisories and news search, not private surveillance.</dd>
            </div>
          </dl>
          <button className="button button-primary live-refresh" type="button" onClick={onRefresh}>
            <span>Force sync now</span>
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
                  <em>Open CISA record</em>
                </a>
              ))
            ) : (
              <p className="empty-feed">Waiting for the CISA feed to respond.</p>
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
                  <em>Open discussion record</em>
                </a>
              ))
            ) : (
              <p className="empty-feed">Waiting for cyber news search results.</p>
            )}
          </div>
        </article>

        <article className="panel source-health-panel">
          <div className="panel-title">Source health</div>
          {(liveIntel?.sources ?? []).map((source) => (
            <div className="source-row" key={source.name}>
              <span className={source.status}>{source.status}</span>
              <strong>{source.name}</strong>
              <small>{source.message ?? `${source.count} records received`}</small>
            </div>
          ))}
          {!liveIntel && <p className="empty-feed">Establishing live source connections.</p>}
        </article>
      </div>
    </section>
  )
}

function ThreatMap({ compact, tick }: { compact: boolean; tick: number }) {
  return (
    <div className={compact ? 'threat-map compact' : 'threat-map'}>
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
      <div className="map-readout">
        <span>Live attacks</span>
        <data>{tick.toLocaleString()}</data>
      </div>
    </div>
  )
}

function PacketStream({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'packet-stream compact' : 'packet-stream'}>
      <div className="panel-title">Live packet stream</div>
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

  return (
    <section className="response-section" id="response">
      <div className="section-header reveal">
        <span>03.</span>
        <div>
          <p className="kicker">Incident response</p>
          <h2>From alert to resolution. Augmented by AI.</h2>
        </div>
        <p className="quote">Turn telemetry into action.</p>
      </div>

      <div className="response-grid reveal delay-1">
        <div className="panel timeline-panel">
          <div className="panel-title">Incident timeline</div>
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
            <span></span>
            <strong>Containment in progress</strong>
            <small>3 hosts isolated / 12 indicators / 0 confirmed data exposure</small>
          </div>
        </div>

        <div className="panel triage-panel">
          <div className="panel-heading">
            <div>
              <div className="panel-title">AI triage report</div>
              <small>Automated analysis / context enrichment</small>
            </div>
            <small>Model v2.4.1</small>
          </div>
          <div className="risk-grid">
            <div>
              <span>Risk score</span>
              <strong>87</strong>
              <small>/ 100</small>
            </div>
            <div>
              <span>Active threat</span>
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
          <div className="panel-title">Forensic artifact viewer</div>
          <div className="tab-row" aria-label="Artifact tabs" role="tablist">
            {(Object.keys(artifactTabs) as ArtifactTab[]).map((tab) => (
              <button
                aria-controls="artifact-panel"
                aria-selected={activeArtifactTab === tab}
                className={activeArtifactTab === tab ? 'active' : ''}
                key={tab}
                onClick={() => setActiveArtifactTab(tab)}
                role="tab"
                type="button"
              >
                {artifactTabs[tab].label}
              </button>
            ))}
          </div>
          <div className="forensic-content" id="artifact-panel" key={activeArtifactTab} role="tabpanel">
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
                <label key={String(label)}>
                  <input type="checkbox" checked={Boolean(done)} readOnly />
                  <span>{label}</span>
                </label>
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
        <p className="kicker">Portfolio / case studies</p>
        <h2>Real operations. Measurable outcomes.</h2>
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
              <p>Impact</p>
              <strong>{study.impact}</strong>
              <span>{study.metric}</span>
              <span>{study.extra}</span>
            </div>
            <div>
              <p>Tools used</p>
              {study.tools.map((tool) => (
                <span key={tool}>{tool}</span>
              ))}
            </div>
            <div>
              <p>Timeline</p>
              <strong>{study.timeline}</strong>
            </div>
            <div>
              <p>Threat category</p>
              <strong className="red-text">{study.category}</strong>
            </div>
            <div className="success-box">
              <span></span>
              Operation successful
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
        <p className="kicker">Skills demonstrated</p>
        <h2>Built to show defensive thinking, not just decoration.</h2>
        <p>
          The lab is a portfolio-grade simulation of how analysts move from signal to
          decision: triage, enrichment, response, reporting, and measurable risk reduction.
        </p>
      </div>
      <div className="skills-grid reveal delay-1">
        {[
          ['Threat intelligence', 'IOC clustering, actor tracking, map-based situational awareness'],
          ['Incident response', 'Containment plans, timeline reconstruction, prioritized actions'],
          ['MITRE mapping', 'Tactics and techniques attached to every alert workflow'],
          ['Forensic analysis', 'Artifacts, hashes, process chain, and evidence summaries'],
          ['Cloud security', 'Exposure checks, remediation records, and prevention metrics'],
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
        <span>Defensive simulation. Portfolio-ready cybersecurity interface.</span>
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
