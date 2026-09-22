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
