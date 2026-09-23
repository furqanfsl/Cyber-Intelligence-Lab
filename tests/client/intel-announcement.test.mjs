import assert from 'node:assert/strict'
import { test } from 'node:test'
import { intelAnnouncement } from '../../src/lib/intel-announcement.ts'
import { initialIntelState } from '../../src/lib/live-intel.ts'

test('refreshing and first connection have clear distinct announcements', () => {
  assert.equal(intelAnnouncement(initialIntelState), 'Connecting to public intelligence sources.')
  assert.equal(intelAnnouncement({ ...initialIntelState, status: 'live', isRefreshing: true }), 'Refreshing public intelligence sources.')
})
test('completed refresh reports current, incomplete, and stale results honestly', () => {
  assert.match(intelAnnouncement({ ...initialIntelState, status: 'live' }), /complete\. Sources are current/)
  assert.match(intelAnnouncement({ ...initialIntelState, status: 'partial' }), /complete with gaps/)
  assert.match(intelAnnouncement({ ...initialIntelState, status: 'stale' }), /Showing older records/)
})
test('failed refresh offers recovery without announcing arbitrary upstream content', () => {
  const text = intelAnnouncement({ ...initialIntelState, status: 'error', error: 'long internal upstream diagnostic' })
  assert.match(text, /Try refreshing or wait/)
  assert.equal(text.includes('diagnostic'), false)
})

test('offline announcements take precedence over previously successful or refreshing state', () => {
  const saved = { ...initialIntelState, isOnline: false, status: 'live', isRefreshing: true, data: { sources: [], kev: [], news: [], advisories: [] } }
  assert.equal(intelAnnouncement(saved), 'You are offline. Saved intelligence records may be out of date.')
  assert.equal(intelAnnouncement({ ...initialIntelState, isOnline: false }), 'You are offline. Reconnect to load public intelligence.')
})
