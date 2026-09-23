import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDemoIncident } from '../../src/lib/demo-scenarios.ts'
import {
  createSimulationSnapshot, advanceSimulationSnapshot,
  SIMULATION_BASE, SIMULATION_BATCH_SIZE, SIMULATION_INTERVAL_MS, SIMULATION_MAX_BATCHES,
} from '../../src/lib/simulation.ts'

function advance(seed, batches) {
  let snapshot = createSimulationSnapshot(seed)
  for (let batch = 0; batch < batches; batch += 1) snapshot = advanceSimulationSnapshot(snapshot, seed)
  return snapshot
}

function freezeDeep(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') freezeDeep(child)
  }
  return Object.freeze(value)
}

test('simulation begins with the existing map baseline and an empty session', () => {
  assert.equal(SIMULATION_BASE, 9503)
  assert.equal(SIMULATION_BATCH_SIZE, 7)
  assert.equal(SIMULATION_INTERVAL_MS, 2600)
  const snapshot = createSimulationSnapshot(123)
  assert.equal(snapshot.total, SIMULATION_BASE)
  assert.equal(snapshot.generatedEvents, 0)
  assert.equal(snapshot.batches, 0)
  assert.deepEqual(snapshot.recentEvents, [])
  assert.equal(snapshot.regions.length, 6)
  assert.equal(new Set(snapshot.regions.map((region) => region.code)).size, 6)
  assert.equal(snapshot.regions.reduce((sum, region) => sum + region.count, 0), SIMULATION_BASE)
  for (const region of snapshot.regions) {
    assert.equal(region.count, region.base)
    assert.ok(region.label.length > 0)
  }
})

test('a generated activity carries its coherent incident and only increases its own region', () => {
  const snapshot = advance(123, 1)
  assert.equal(snapshot.total, SIMULATION_BASE + 7)
  assert.equal(snapshot.generatedEvents, 7)
  assert.equal(snapshot.batches, 1)
  assert.equal(snapshot.recentEvents.length, 1)
  const event = snapshot.recentEvents[0]
  assert.equal(event.batch, 1)
  assert.equal(event.added, 7)
  assert.ok(event.title.length > 0)
  assert.deepEqual(event.incident, createDemoIncident(123, 1))
  assert.equal(event.title, event.incident.title)
  assert.equal(event.regionCode, event.incident.regionCode)
  assert.equal(event.regionLabel, snapshot.regions.find((region) => region.code === event.regionCode).label)
  for (const region of snapshot.regions) assert.equal(region.count - region.base, region.code === event.regionCode ? 7 : 0)
})

test('seeded replay is deterministic and different seeds produce different reports and activity sequences', () => {
  const first = advance(123, 10)
  assert.deepEqual(advance(123, 10), first)
  assert.notDeepEqual(advance(124, 10), first)
  const reports = new Set(Array.from({ length: 20 }, (_, seed) => JSON.stringify(advance(seed, 1).recentEvents[0].incident)))
  assert.equal(reports.size, 20)
})

test('randomized batches reconcile every map region with both total and retained event reports', () => {
  for (const seed of [0, 1, 42, 0xffff_ffff]) {
    let snapshot = createSimulationSnapshot(seed)
    const expected = new Map(snapshot.regions.map((region) => [region.code, region.base]))
    for (let batch = 1; batch <= 1000; batch += 1) {
      snapshot = advanceSimulationSnapshot(snapshot, seed)
      const event = snapshot.recentEvents[0]
      expected.set(event.regionCode, expected.get(event.regionCode) + 7)
      assert.equal(snapshot.batches, batch)
      assert.equal(snapshot.generatedEvents, batch * 7)
      assert.equal(snapshot.total, SIMULATION_BASE + batch * 7)
      assert.equal(snapshot.regions.reduce((sum, region) => sum + region.count, 0), snapshot.total)
      for (const region of snapshot.regions) assert.equal(region.count, expected.get(region.code))
      assert.equal(event.title, event.incident.title)
      assert.equal(event.regionCode, event.incident.regionCode)
    }
    assert.equal(new Set(snapshot.regions.map((region) => region.count - region.base)).size > 1, true)
    assert.ok(snapshot.regions.every((region) => region.count > region.base))
  }
})

test('recent activity remains bounded, newest first, and preserves earlier full reports', () => {
  let snapshot = createSimulationSnapshot(99)
  const knownEvents = new Map()
  for (let batch = 1; batch <= 30; batch += 1) {
    snapshot = advanceSimulationSnapshot(snapshot, 99)
    knownEvents.set(batch, structuredClone(snapshot.recentEvents[0]))
    assert.equal(snapshot.recentEvents.length, Math.min(3, batch))
    snapshot.recentEvents.forEach((event, index) => {
      assert.equal(event.batch, batch - index)
      assert.deepEqual(event, knownEvents.get(event.batch))
    })
  }
})

test('advance accepts frozen or cloned snapshots without mutating a selected earlier report', () => {
  const first = freezeDeep(advance(73, 2))
  const saved = structuredClone(first)
  const selectedIncident = first.recentEvents[1].incident
  const next = advanceSimulationSnapshot(first, 73)
  assert.deepEqual(first, saved)
  assert.deepEqual(advanceSimulationSnapshot(structuredClone(first), 73), next)
  assert.equal(next.recentEvents[2].incident, selectedIncident)
  assert.notEqual(next.regions, first.regions)
  assert.ok(next.regions.every((region, index) => region !== first.regions[index]))
  assert.deepEqual(createSimulationSnapshot(73), createSimulationSnapshot(74))
})

test('factory and advance reject invalid seeds rather than silently coercing random state', () => {
  for (const seed of [NaN, Infinity, -Infinity, -1, 0.5, 0x1_0000_0000, undefined, null, '1']) {
    assert.throws(() => createSimulationSnapshot(seed), RangeError, `seed ${seed}`)
    assert.throws(() => advanceSimulationSnapshot(createSimulationSnapshot(1), seed), RangeError, `seed ${seed}`)
  }
  assert.doesNotThrow(() => createSimulationSnapshot(0))
  assert.doesNotThrow(() => createSimulationSnapshot(0xffff_ffff))
})

test('advance rejects inconsistent totals, batches, region arrays and malformed regional telemetry', () => {
  const valid = advance(7, 3)
  const invalid = []
  for (const batches of [NaN, Infinity, -1, 1.5]) invalid.push({ ...structuredClone(valid), batches })
  invalid.push({ ...structuredClone(valid), generatedEvents: valid.generatedEvents + 1 })
  invalid.push({ ...structuredClone(valid), total: valid.total + 1 })
  invalid.push({ ...structuredClone(valid), regions: [] })
  invalid.push({ ...structuredClone(valid), recentEvents: [] })
  for (const [key, value] of [['code', 'unknown'], ['label', 'Invalid'], ['base', 0], ['count', NaN], ['count', Infinity], ['count', 0], ['count', 1843]]) {
    const snapshot = structuredClone(valid)
    snapshot.regions[0][key] = value
    invalid.push(snapshot)
  }
  const mismatched = structuredClone(valid)
  mismatched.regions[0].count += 7
  invalid.push(mismatched)
  for (const snapshot of invalid) assert.throws(() => advanceSimulationSnapshot(snapshot, 7), RangeError)
})

test('advance rejects incoherent or reordered retained activity', () => {
  const valid = advance(7, 3)
  for (const [key, value] of [['batch', 1], ['added', 1], ['regionCode', 'unknown'], ['regionLabel', 'Unknown'], ['title', 'Not this report']]) {
    const snapshot = structuredClone(valid)
    snapshot.recentEvents[0][key] = value
    assert.throws(() => advanceSimulationSnapshot(snapshot, 7), RangeError)
  }
  const snapshot = structuredClone(valid)
  snapshot.recentEvents[0].incident.regionCode = snapshot.recentEvents[0].regionCode === 'na' ? 'eu' : 'na'
  assert.throws(() => advanceSimulationSnapshot(snapshot, 7), RangeError)
})

test('the terminal batch remains bounded and cannot exceed the model limit', () => {
  const seed = 42
  const snapshot = createSimulationSnapshot(seed)
  snapshot.batches = SIMULATION_MAX_BATCHES - 1
  snapshot.generatedEvents = snapshot.batches * 7
  snapshot.total = SIMULATION_BASE + snapshot.generatedEvents
  snapshot.regions[0].count += snapshot.generatedEvents
  snapshot.recentEvents = [0, 1, 2].map((offset) => {
    const batch = snapshot.batches - offset
    const incident = createDemoIncident(seed, batch)
    return { batch, title: incident.title, regionCode: incident.regionCode,
      regionLabel: snapshot.regions.find((region) => region.code === incident.regionCode).label, added: 7, incident }
  })
  const last = advanceSimulationSnapshot(snapshot, seed)
  assert.equal(last.batches, SIMULATION_MAX_BATCHES)
  assert.equal(last.total, SIMULATION_BASE + SIMULATION_MAX_BATCHES * 7)
  assert.equal(last.recentEvents.length, 3)
  assert.throws(() => advanceSimulationSnapshot(last, seed), RangeError)
})
