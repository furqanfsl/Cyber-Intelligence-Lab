import type { ReactNode } from 'react'
import { SIMULATION_INTERVAL_MS } from '../lib/simulation'
import type { SimulationSnapshot } from '../lib/simulation'
import type { DemoIncident } from '../lib/demo-scenarios'
import './SimulationConsole.css'

type Props = {
  snapshot: SimulationSnapshot
  sessionId: string
  selectedIncidentId: string
  onSelectIncident: (incident: DemoIncident) => void
  onPauseForReview: () => void
  running: boolean
  hasStarted: boolean
  hidden: boolean
  motionEnabled: boolean
  onToggle: () => void
  onReset: () => void
  children: ReactNode
}

export function SimulationConsole({ snapshot, sessionId, selectedIncidentId, onSelectIncident, onPauseForReview, running, hasStarted, hidden, motionEnabled, onToggle, onReset, children }: Props) {
  const state = running ? hidden ? 'background' : 'running' : hasStarted ? 'paused' : 'ready'
  const labels = { ready: 'Simulation ready', running: 'Simulation running', paused: 'Simulation paused', background: 'Paused in background' }
  const details = {
    ready: 'Five fresh scenarios are ready. Start the replay to generate more.',
    running: 'Generating synthetic events. No real traffic is monitored.',
    paused: 'Replay stopped. Your session is saved until you reset or reload.',
    background: 'Event generation resumes when you return to this tab.',
  }

  return (
    <div className="simulation-console" data-state={state} data-session-id={sessionId}>
      <div className="panel-heading simulation-heading">
        <div><div className="panel-title">Simulated threat map</div><small>Interactive replay / synthetic data only</small></div>
        <div className="simulation-controls" role="group" aria-label="Simulation controls">
          <button className="simulation-toggle" type="button" aria-pressed={running} onClick={onToggle} aria-controls="simulation-map simulation-events">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d={running ? 'M6 4v12M14 4v12' : 'M6 3l10 7-10 7z'} /></svg>
            {running ? 'Pause simulation' : hasStarted ? 'Resume simulation' : 'Start simulation'}
          </button>
          <button className="simulation-reset" type="button" onClick={onReset} disabled={!hasStarted}>Reset demo</button>
        </div>
      </div>

      <div className="simulation-session-bar">
        <span className="simulation-session-id">Session {sessionId}</span>
        <button type="button" onClick={onReset}>New scenario set <span aria-hidden="true">↻</span></button>
      </div>

      <div className="simulation-state-strip">
        <div className="simulation-status" role="status" aria-live="polite" aria-atomic="true">
          <strong><span className="simulation-state-dot" aria-hidden="true" />{labels[state]}</strong>
          <p>{details[state]}</p>
        </div>
        <div className="simulation-session">
          <span>Generated this session</span>
          <strong className="simulation-session-count">+{snapshot.generatedEvents.toLocaleString()}</strong>
        </div>
      </div>

      <div id="simulation-map">{children}</div>

      <div className="simulation-events" id="simulation-events">
        <div className="simulation-events-heading"><h3>Latest demo activity</h3><span>+7 events / {SIMULATION_INTERVAL_MS / 1000}s</span></div>
        {snapshot.recentEvents.length ? (
          <ol className="simulation-event-list" onFocusCapture={onPauseForReview}>
            {snapshot.recentEvents.map((event, index) => (
              <li className={index === 0 ? 'simulation-latest' : ''} key={event.batch} data-batch={event.batch}>
                <button type="button" aria-pressed={selectedIncidentId === event.incident.id}
                  data-incident-id={event.incident.id} aria-haspopup="dialog"
                  onClick={() => onSelectIncident(event.incident)}>
                <span className="simulation-batch">{String(event.batch).padStart(3, '0')}</span>
                <span className="simulation-event-title">{event.title}<small>{event.regionLabel} · {event.incident.asset}</small></span>
                <span className="simulation-event-action"><strong>+{event.added}</strong><span>{selectedIncidentId === event.incident.id ? 'Selected' : 'Inspect'} <span aria-hidden="true">↗</span></span></span>
                </button>
              </li>
            ))}
          </ol>
        ) : <div className="simulation-empty">Nothing running yet.<span>Start simulation to see events appear here, the session counter increase and the active map region change.</span></div>}
      </div>
      <p className="simulation-footnote">Select any activity to open its evidence and response together. Reviewing pauses the replay. Each batch adds one randomized incident; Reset demo creates a fresh session. {motionEnabled ? 'Active regions light up as batches arrive.' : 'Visual motion is off; counts still update.'}</p>
    </div>
  )
}
