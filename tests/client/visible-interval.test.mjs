import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createVisibleInterval } from '../../src/lib/visible-interval.ts'

function environment(hidden = false) {
  const target = new EventTarget()
  target.hidden = hidden
  const jobs = new Map()
  let id = 0
  return {
    target, jobs,
    timers: { schedule: (callback) => { jobs.set(++id, callback); return id }, cancel: (key) => jobs.delete(key) },
    visibility(hidden) { target.hidden = hidden; target.dispatchEvent(new Event('visibilitychange')) },
    tick() { for (const callback of jobs.values()) callback() },
  }
}

test('opted-in simulation pauses while hidden and resumes with one interval', () => {
  const e = environment(); let ticks = 0
  const stop = createVisibleInterval(() => ticks++, 2600, e.target, e.timers)
  e.tick(); assert.equal(ticks, 1)
  e.visibility(true); assert.equal(e.jobs.size, 0); e.tick(); assert.equal(ticks, 1)
  e.visibility(false); e.visibility(false); assert.equal(e.jobs.size, 1)
  e.tick(); assert.equal(ticks, 2); stop(); assert.equal(e.jobs.size, 0)
})
test('simulation started on a hidden page waits until visible', () => {
  const e = environment(true)
  const stop = createVisibleInterval(() => {}, 2600, e.target, e.timers)
  assert.equal(e.jobs.size, 0); e.visibility(false); assert.equal(e.jobs.size, 1); stop()
})
test('user pause disposes the listener and visibility cannot restart the simulation', () => {
  const e = environment()
  const stop = createVisibleInterval(() => {}, 2600, e.target, e.timers)
  stop(); e.visibility(true); e.visibility(false); stop()
  assert.equal(e.jobs.size, 0)
})
