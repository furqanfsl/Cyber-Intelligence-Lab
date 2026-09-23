import { createDemoIncident, type DemoIncident } from './demo-scenarios.ts'

export const SIMULATION_BASE = 9503
export const SIMULATION_BATCH_SIZE = 7
export const SIMULATION_INTERVAL_MS = 2600
export const SIMULATION_MAX_BATCHES = 1_000_000_000

const regions = [
  { code: 'na', label: 'N. America', base: 1842 },
  { code: 'eu', label: 'Europe', base: 2317 },
  { code: 'asia', label: 'Asia', base: 3961 },
  { code: 'sa', label: 'S. America', base: 672 },
  { code: 'af', label: 'Africa', base: 418 },
  { code: 'oc', label: 'Oceania', base: 293 },
] as const

export type SimulationRegion = {
  code: typeof regions[number]['code']
  label: string
  base: number
  count: number
}

export type SimulationEvent = {
  batch: number
  title: string
  regionCode: DemoIncident['regionCode']
  regionLabel: string
  added: number
  incident: DemoIncident
}

export type SimulationSnapshot = {
  total: number
  generatedEvents: number
  batches: number
  regions: SimulationRegion[]
  recentEvents: SimulationEvent[]
}

function validateSeed(seed: number) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    throw new RangeError('Simulation seed must be an unsigned 32-bit integer')
  }
}

/** Validates local replay state without re-generating or retaining its history. */
function validateSnapshot(snapshot: SimulationSnapshot) {
  if (!Number.isInteger(snapshot.batches) || snapshot.batches < 0 || snapshot.batches >= SIMULATION_MAX_BATCHES
    || snapshot.generatedEvents !== snapshot.batches * SIMULATION_BATCH_SIZE
    || snapshot.total !== SIMULATION_BASE + snapshot.generatedEvents
    || snapshot.regions.length !== regions.length
    || snapshot.recentEvents.length !== Math.min(snapshot.batches, 3)) {
    throw new RangeError('Invalid or exhausted simulation state')
  }
  let total = 0
  for (let index = 0; index < regions.length; index += 1) {
    const region = snapshot.regions[index]
    const baseline = regions[index]
    if (region.code !== baseline.code || region.label !== baseline.label || region.base !== baseline.base
      || !Number.isSafeInteger(region.count) || region.count < region.base
      || (region.count - region.base) % SIMULATION_BATCH_SIZE !== 0) {
      throw new RangeError('Invalid simulation region')
    }
    total += region.count
  }
  if (total !== snapshot.total) throw new RangeError('Simulation regions must reconcile with the total')
  for (let index = 0; index < snapshot.recentEvents.length; index += 1) {
    const event = snapshot.recentEvents[index]
    const region = regions.find(({ code }) => code === event.regionCode)
    if (!region || event.batch !== snapshot.batches - index || event.added !== SIMULATION_BATCH_SIZE
      || event.regionLabel !== region.label || event.title !== event.incident.title
      || event.regionCode !== event.incident.regionCode) {
      throw new RangeError('Invalid simulation activity')
    }
  }
}

/** An empty demo session. The fixed historical baseline is never presented as live traffic. */
export function createSimulationSnapshot(seed: number): SimulationSnapshot {
  validateSeed(seed)
  return {
    total: SIMULATION_BASE,
    generatedEvents: 0,
    batches: 0,
    regions: regions.map((region) => ({ ...region, count: region.base })),
    recentEvents: [],
  }
}

/** Pure, bounded replay step: one coherent incident per batch, with no external data or side effects. */
export function advanceSimulationSnapshot(snapshot: SimulationSnapshot, seed: number): SimulationSnapshot {
  validateSeed(seed)
  validateSnapshot(snapshot)
  const batch = snapshot.batches + 1
  const incident = createDemoIncident(seed, batch)
  const region = regions.find(({ code }) => code === incident.regionCode)!
  const event: SimulationEvent = {
    batch,
    title: incident.title,
    regionCode: incident.regionCode,
    regionLabel: region.label,
    added: SIMULATION_BATCH_SIZE,
    incident,
  }
  return {
    total: snapshot.total + SIMULATION_BATCH_SIZE,
    generatedEvents: snapshot.generatedEvents + SIMULATION_BATCH_SIZE,
    batches: batch,
    regions: snapshot.regions.map((item) => ({
      ...item,
      count: item.count + (item.code === incident.regionCode ? SIMULATION_BATCH_SIZE : 0),
    })),
    recentEvents: [event, ...snapshot.recentEvents.slice(0, 2)],
  }
}
