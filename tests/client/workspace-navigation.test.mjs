import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveWorkspaceHash, workspaceHash, workspaces } from '../../src/lib/workspace-navigation.ts'

test('five canonical workspaces resolve to distinct views', () => {
  assert.equal(workspaces.length, 5)
  assert.equal(new Set(workspaces.map(({ id }) => id)).size, 5)
  for (const workspace of workspaces) {
    assert.equal(resolveWorkspaceHash(workspace.hash).workspace, workspace.id)
    assert.equal(workspaceHash(workspace.id), workspace.hash)
  }
})

test('the retired Cases bookmark opens Training without a separate cases destination', () => {
  assert.deepEqual(resolveWorkspaceHash('#cases'), { workspace: 'training', anchor: 'cases', skipLink: false })
  assert.equal(workspaces.some(({ id, hash }) => id === 'cases' || hash === '#cases'), false)
  assert.equal(workspaceHash(resolveWorkspaceHash('#cases').workspace), '#operations')
})

test('the default and legacy home addresses open the compact overview', () => {
  for (const hash of ['', '#', '#overview', '#top', 'top']) {
    assert.equal(resolveWorkspaceHash(hash).workspace, 'overview')
  }
})

test('legacy response and selected-alert anchors retain their training meaning', () => {
  for (const anchor of ['operations', 'response', 'selected-demo-alert']) {
    assert.deepEqual(resolveWorkspaceHash(`#${anchor}`), { workspace: 'training', anchor, skipLink: false })
  }
  assert.equal(resolveWorkspaceHash('#source-diagnostics').workspace, 'live-intel')
  assert.equal(resolveWorkspaceHash('#live-intelligence').workspace, 'live-intel')
  assert.equal(resolveWorkspaceHash('#training').workspace, 'training')
})

test('skip-to-content preserves the current view, including a missing view', () => {
  for (const current of [...workspaces.map(({ id }) => id), null]) {
    assert.deepEqual(resolveWorkspaceHash('#main-content', current), { workspace: current, anchor: 'main-content', skipLink: true })
  }
})

test('valid encoded deep links decode once while malformed and unknown links fail closed', () => {
  assert.equal(resolveWorkspaceHash('#%65ndpoint').workspace, 'endpoint')
  for (const hash of ['#missing', '#constructor', '#__proto__', '#Endpoint', '#endpoint?start=1', '#%2565ndpoint', '#%ZZ', '#%E0%A4%A', '#<script>', '##endpoint']) {
    assert.deepEqual(resolveWorkspaceHash(hash), { workspace: null, anchor: null, skipLink: false })
  }
})

test('the unknown-view recovery and footer destination are safe canonical addresses', () => {
  assert.equal(workspaceHash(null), '#overview')
  assert.equal(workspaceHash('training'), '#operations')
  assert.equal(workspaceHash('endpoint'), '#endpoint')
})
