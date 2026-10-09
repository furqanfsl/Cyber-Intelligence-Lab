export type WorkspaceId = 'overview' | 'endpoint' | 'investigation' | 'live-intel' | 'training'

export const workspaces: ReadonlyArray<{ id: WorkspaceId; hash: string; label: string; title: string; description: string }> = [
  { id: 'overview', hash: '#overview', label: 'Overview', title: 'Overview', description: 'Choose a task. Real local evidence, public context and training stay separate.' },
  { id: 'endpoint', hash: '#endpoint', label: 'PC', title: 'PC monitoring', description: 'Review real Microsoft Defender detections and explainable log-rule matches from this Windows PC. Monitoring is opt-in, local and read-only. No paid AI is required.' },
  { id: 'investigation', hash: '#investigation', label: 'Logs', title: 'Log investigation', description: 'Investigate an authorized log export in this browser. No log upload or paid AI is required.' },
  { id: 'live-intel', hash: '#live-intel', label: 'Live intel', title: 'Live intelligence', description: 'Browse official CISA and Microsoft updates, plus unverified community context. Public records are not evidence of a threat on this PC.' },
  { id: 'training', hash: '#operations', label: 'Training', title: 'Training', description: 'Practice investigation and response with fictional incidents. No real systems are changed.' },
]

export type WorkspaceRoute = {
  workspace: WorkspaceId | null
  anchor: string | null
  skipLink: boolean
}

const anchorWorkspaces: Readonly<Record<string, WorkspaceId>> = {
  overview: 'overview', top: 'overview',
  endpoint: 'endpoint',
  investigation: 'investigation',
  'live-intel': 'live-intel', 'live-intelligence': 'live-intel', 'source-diagnostics': 'live-intel',
  operations: 'training', training: 'training', response: 'training', 'selected-demo-alert': 'training',
  // Keep published bookmarks useful after retiring the static case-study view.
  cases: 'training',
}

/** Hash routes work on local launchers and static hosts without a server fallback. */
export function resolveWorkspaceHash(hash: string, current: WorkspaceId | null = 'overview'): WorkspaceRoute {
  let anchor: string
  try { anchor = decodeURIComponent(hash.startsWith('#') ? hash.slice(1) : hash) }
  catch { return { workspace: null, anchor: null, skipLink: false } }
  if (!anchor) return { workspace: 'overview', anchor: null, skipLink: false }
  if (anchor === 'main-content') return { workspace: current, anchor, skipLink: true }
  const workspace = Object.hasOwn(anchorWorkspaces, anchor) ? anchorWorkspaces[anchor] : null
  return { workspace, anchor: workspace ? anchor : null, skipLink: false }
}

export function workspaceHash(workspace: WorkspaceId | null): string {
  return workspaces.find((item) => item.id === workspace)?.hash ?? '#overview'
}
