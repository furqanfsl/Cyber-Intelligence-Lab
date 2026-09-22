import type { LiveIntelState } from './live-intel.ts'

/** Keep refresh announcements brief instead of rereading the entire feed. */
export function intelAnnouncement(state: LiveIntelState): string {
  if (state.isRefreshing) return 'Refreshing public intelligence sources.'
  if (state.status === 'connecting') return 'Connecting to public intelligence sources.'
  if (state.status === 'live') return 'Public intelligence refresh complete. Sources are current.'
  if (state.status === 'partial') return 'Public intelligence refresh complete with gaps. Check source health.'
  if (state.status === 'stale') return 'Public intelligence refresh is incomplete. Showing older records.'
  return 'Public intelligence is unavailable. Try refreshing or wait for the next check.'
}
