import { Component } from 'react'
import type { ReactNode } from 'react'

/** Render failures get a safe recovery screen, never raw exceptions or stack traces. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="boot-screen app-recovery" aria-labelledby="app-recovery-title">
        <div className="boot-brand">Cyber Intelligence Lab</div>
        <section className="boot-content">
          <p className="boot-eyebrow">Workspace interrupted</p>
          <h1 id="app-recovery-title">The lab hit a problem</h1>
          <p className="boot-message" role="alert">The interface could not finish rendering. Reload to start a fresh session.</p>
          <div className="boot-actions">
            <button className="boot-primary" type="button" onClick={() => window.location.reload()}>Reload lab</button>
          </div>
          <p className="boot-help">Your current demo session will reset. If the problem returns, the site may need an update.</p>
        </section>
        <p className="boot-footnote">No real systems are controlled by the demo.</p>
      </main>
    )
  }
}
