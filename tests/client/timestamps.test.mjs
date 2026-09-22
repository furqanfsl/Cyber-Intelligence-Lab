import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatTimestamp } from '../../src/lib/timestamps.ts'

test('local source timestamps include an explicit daylight-saving UTC offset', () => {
  const text = formatTimestamp('2026-09-22T12:00:00Z', { locale: 'en-GB', timeZone: 'Europe/London' })
  assert.match(text, /22 Sept 2026/); assert.match(text, /13:00:00 GMT\+1/)
})
test('winter UTC timestamps and nonwhole-hour zones remain unambiguous', () => {
  assert.match(formatTimestamp('2026-01-22T12:00:00Z', { locale: 'en-GB', timeZone: 'Europe/London' }), /12:00:00 GMT(?:\+0)?$/)
  assert.match(formatTimestamp('2026-09-22T12:00:00Z', { locale: 'en-GB', timeZone: 'Asia/Kolkata' }), /17:30:00 GMT\+5:30/)
})
test('equivalent absolute source offsets display the same instant', () => {
  const options = { locale: 'en-GB', timeZone: 'UTC' }
  assert.equal(formatTimestamp('2026-09-22T13:00:00+01:00', options), formatTimestamp('2026-09-22T12:00:00Z', options))
})
test('invalid, missing, or timezone-free input has a safe readable fallback', () => {
  for (const value of [null, undefined, '', 'yesterday', '2026-09-22', '2026-09-22T12:00:00', '2026-99-22T12:00:00Z', '2026-02-30T12:00:00Z']) {
    assert.equal(formatTimestamp(value), 'Time unavailable')
  }
  assert.equal(formatTimestamp('2026-09-22T12:00:00Z', { timeZone: 'not-a-zone' }), 'Time unavailable')
})

test('repeated daylight-saving clock times remain distinguishable by their UTC offsets', () => {
  const options = { locale: 'en-GB', timeZone: 'Europe/London' }
  const before = formatTimestamp('2026-10-25T00:30:00Z', options)
  const after = formatTimestamp('2026-10-25T01:30:00Z', options)
  assert.match(before, /01:30:00 GMT\+1/)
  assert.match(after, /01:30:00 GMT(?:\+0)?$/)
  assert.notEqual(before, after)
})
test('local timezone conversion preserves the correct calendar day across year boundaries', () => {
  const instant = '2026-01-01T00:15:00Z'
  const west = formatTimestamp(instant, { locale: 'en-GB', timeZone: 'America/Los_Angeles' })
  const east = formatTimestamp(instant, { locale: 'en-GB', timeZone: 'Asia/Tokyo' })
  assert.match(west, /31 Dec 2025, 16:15:00 GMT-8/)
  assert.match(east, /1 Jan 2026, 09:15:00 GMT\+9/)
})
