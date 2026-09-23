import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import type { DemoIncident } from '../lib/demo-scenarios.ts'
import type { ArtifactTab } from '../data/scenarios.ts'
import { nextTab } from '../lib/keyboard-tabs.ts'
import './IncidentWorkspace.css'

type Props = {
  incident: DemoIncident | null
  onClose: () => void
  motionEnabled: boolean
}

const artifactTabs: ArtifactTab[] = ['file', 'network', 'process', 'registry']

/** Native modal isolation keeps the selected synthetic dossier independent of the background replay. */
export function IncidentWorkspace({ incident, onClose, motionEnabled }: Props) {
  return incident ? <WorkspaceDialog key={incident.id} incident={incident} onClose={onClose} motionEnabled={motionEnabled} /> : null
}

function WorkspaceDialog({ incident, onClose, motionEnabled }: Omit<Props, 'incident'> & { incident: DemoIncident }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closingRef = useRef(false)
  const [closing, setClosing] = useState(false)
  const [activeTab, setActiveTab] = useState<ArtifactTab>('file')
  const scenario = incident.details
  const artifact = scenario.artifacts[activeTab]

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    mountedRef.current = true
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousBodyOverflow = document.body.style.overflow
    const previousBodyPadding = document.body.style.paddingRight
    const previousRootOverflow = document.documentElement.style.overflow
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${parseFloat(getComputedStyle(document.body).paddingRight) + scrollbarWidth}px`
    }
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    dialog.showModal()
    return () => {
      mountedRef.current = false
      if (closeTimer.current) clearTimeout(closeTimer.current)
      dialog.close()
      document.body.style.overflow = previousBodyOverflow
      document.body.style.paddingRight = previousBodyPadding
      document.documentElement.style.overflow = previousRootOverflow
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])

  function requestClose() {
    if (closingRef.current) return
    closingRef.current = true
    setClosing(true)
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!motionEnabled || reducedMotion) {
      dialogRef.current?.close()
    } else {
      closeTimer.current = setTimeout(() => dialogRef.current?.close(), 180)
    }
  }

  function handleBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) requestClose()
  }

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const tab = nextTab(artifactTabs, activeTab, event.key)
    if (!tab) return
    event.preventDefault()
    setActiveTab(tab)
    document.getElementById(`workspace-tab-${tab}`)?.focus()
  }

  function handleDialogKey(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return
    const dialog = event.currentTarget
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]')]
      .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0)
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    if (!first || !last) { event.preventDefault(); dialog.focus(); return }
    if (active === dialog || !dialog.contains(active) || (event.shiftKey ? active === first : active === last)) {
      event.preventDefault()
      const target = event.shiftKey ? last : first
      target.focus()
    }
  }

  function jumpToPane(paneName: 'evidence' | 'response') {
    const body = bodyRef.current
    const pane = dialogRef.current?.querySelector<HTMLElement>(`#workspace-${paneName}-pane`)
    if (!body || !pane) return
    const top = pane.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop
    pane.focus({ preventScroll: true })
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    body.scrollTo({ top, behavior: motionEnabled && !reducedMotion ? 'smooth' : 'instant' })
  }

  return (
    <dialog
      ref={dialogRef}
      className="incident-workspace"
      aria-labelledby="workspace-title"
      aria-describedby="workspace-disclaimer"
      data-motion={motionEnabled ? 'on' : 'off'}
      data-closing={closing}
      data-incident-id={incident.id}
      data-asset={incident.asset}
      data-template-id={incident.templateId}
      onCancel={(event) => { event.preventDefault(); requestClose() }}
      onClick={handleBackdropClick}
      onKeyDown={handleDialogKey}
      onClose={() => { if (mountedRef.current && !dialogRef.current?.open) onClose() }}
    >
      <header className="workspace-header">
        <div>
          <p className="workspace-eyebrow">Demo investigation <span aria-hidden="true">/</span> <code>{incident.id}</code></p>
          <h2 id="workspace-title">{incident.title}</h2>
          <p id="workspace-disclaimer">Fictional evidence and proposed responses. No real systems are monitored or changed.</p>
        </div>
        <button className="workspace-close" type="button" onClick={requestClose} autoFocus>
          <span>Close investigation</span><span aria-hidden="true">×</span>
        </button>
        <nav className="workspace-jump" aria-label="Investigation sections">
          <button type="button" aria-controls="workspace-evidence-pane" onClick={() => jumpToPane('evidence')}><span aria-hidden="true">01</span> Evidence</button>
          <button type="button" aria-controls="workspace-response-pane" onClick={() => jumpToPane('response')}><span aria-hidden="true">02</span> Response plan</button>
        </nav>
      </header>

      <div className="workspace-body" ref={bodyRef}>
        <section id="workspace-evidence-pane" className="workspace-pane workspace-evidence" aria-labelledby="workspace-evidence-title" tabIndex={0}>
          <div className="workspace-pane-heading">
            <div><span className="workspace-step">01 / Investigate</span><h3 id="workspace-evidence-title">Evidence</h3></div>
            <span className={`workspace-severity ${incident.severity}`}>{incident.severity}</span>
          </div>

          <dl className="workspace-facts">
            {[
              ['Asset', incident.asset], ['Region', incident.region], ['Observed at', `${incident.time} · demo time`],
              ['Pattern', incident.actor], ['Vector', incident.vector], ['Technique', incident.technique],
            ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>

          <section className="workspace-section" aria-labelledby="workspace-indicators-title">
            <h4 id="workspace-indicators-title">Sample indicators</h4>
            <p className="workspace-help">Reserved addresses and example domains, not real indicators of compromise.</p>
            <dl className="workspace-facts">
              {scenario.indicators.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            </dl>
          </section>

          <section className="workspace-section" aria-labelledby="workspace-artifacts-title">
            <h4 id="workspace-artifacts-title">Forensic artifacts</h4>
            <div className="workspace-tabs" role="tablist" aria-label="Investigation artifact tabs">
              {artifactTabs.map((tab) => (
                <button
                  key={tab}
                  id={`workspace-tab-${tab}`}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab}
                  aria-controls="workspace-artifact-panel"
                  tabIndex={activeTab === tab ? 0 : -1}
                  onClick={() => setActiveTab(tab)}
                  onKeyDown={handleTabKey}
                >{scenario.artifacts[tab].label}</button>
              ))}
            </div>
            <div className="workspace-artifact" id="workspace-artifact-panel" role="tabpanel" aria-labelledby={`workspace-tab-${activeTab}`} tabIndex={0}>
              <dl className="workspace-facts">
                {artifact.fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
              </dl>
              <ul className="workspace-checklist">
                {artifact.checklist.map(([label, done]) => <li key={label}><span className={done ? 'workspace-done' : 'workspace-pending'}>{done ? 'Done' : 'Pending'}</span><span>{label}</span></li>)}
              </ul>
            </div>
          </section>
        </section>

        <section id="workspace-response-pane" className="workspace-pane workspace-response" aria-labelledby="workspace-response-title" tabIndex={0}>
          <div className="workspace-pane-heading">
            <div><span className="workspace-step">02 / Decide</span><h3 id="workspace-response-title">Response plan</h3></div>
            <span className="workspace-proposed">Proposed only</span>
          </div>
          <p className="workspace-summary">{scenario.summary}</p>
          <div className="workspace-risk">
            <div><span>Illustrative risk</span><strong className={incident.severity}>{scenario.riskScore}<small> / 100</small></strong></div>
            <div><span>Scenario phase</span><strong>{scenario.phase}</strong><small>{incident.status}</small></div>
          </div>

          <section className="workspace-section" aria-labelledby="workspace-actions-title">
            <h4 id="workspace-actions-title">Recommended exercise steps</h4>
            <ol className="workspace-actions">
              {scenario.actions.map((action, index) => <li key={action.label}><span className="workspace-number">{String(index + 1).padStart(2, '0')}</span><span>{action.label}</span><span className={`workspace-priority ${action.priority.toLowerCase()}`}>{action.priority}</span></li>)}
            </ol>
          </section>

          <section className="workspace-section" aria-labelledby="workspace-timeline-title">
            <h4 id="workspace-timeline-title">Evidence timeline</h4>
            <ol className="workspace-timeline">
              {scenario.timeline.map((item, index) => <li key={`${item.stage}-${index}`}><time>{item.time}</time><div><strong>{item.stage}</strong><p>{item.copy}</p></div></li>)}
            </ol>
          </section>

          <section className="workspace-section" aria-labelledby="workspace-containment-title">
            <h4 id="workspace-containment-title">Example containment status</h4>
            <ul className="workspace-checklist">
              {scenario.containment.map((item) => <li key={item.label}><span className={item.done ? 'workspace-done' : 'workspace-pending'}>{item.done ? 'Done' : 'Pending'}</span><span>{item.label}</span></li>)}
            </ul>
            <p className="workspace-help workspace-boundary">These are exercise checkpoints, not executed security actions.</p>
          </section>
        </section>
      </div>
    </dialog>
  )
}
