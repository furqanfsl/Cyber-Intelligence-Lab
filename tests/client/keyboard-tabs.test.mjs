import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextTab } from '../../src/lib/keyboard-tabs.ts'
const tabs = ['file', 'network', 'process', 'registry']
test('arrow keys select neighbours and wrap at both ends', () => {
  assert.equal(nextTab(tabs, 'file', 'ArrowRight'), 'network')
  assert.equal(nextTab(tabs, 'file', 'ArrowLeft'), 'registry')
  assert.equal(nextTab(tabs, 'registry', 'ArrowRight'), 'file')
  assert.equal(nextTab(tabs, 'process', 'ArrowLeft'), 'network')
})
test('Home and End select first and last tabs', () => {
  assert.equal(nextTab(tabs, 'process', 'Home'), 'file')
  assert.equal(nextTab(tabs, 'network', 'End'), 'registry')
})
test('unhandled keys remain available to browser and assistive technology', () => {
  for (const key of ['Tab', 'Enter', 'ArrowDown', 'a']) assert.equal(nextTab(tabs, 'file', key), undefined)
})
test('missing or empty tab collections do not produce invalid selections', () => {
  assert.equal(nextTab([], 'file', 'Home'), undefined)
  assert.equal(nextTab(tabs, 'missing', 'ArrowRight'), undefined)
})
