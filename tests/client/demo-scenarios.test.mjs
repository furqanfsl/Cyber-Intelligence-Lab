import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDemoIncident, createDemoSession } from '../../src/lib/demo-scenarios.ts'
import { scenarioDetails } from '../../src/data/scenarios.ts'

const seeds = [0, 1, 42, 65_535, 0x12345678, 0xffffffff]
const field = (fields, label) => fields.find(([key]) => key === label)?.[1]
const toSeconds = (value) => value.split(':').reduce((total, part) => total * 60 + Number(part), 0)
const samples = () => seeds.flatMap((seed) => [
  ...createDemoSession(seed).initialIncidents,
  ...Array.from({ length: 30 }, (_, index) => createDemoIncident(seed, index + 1)),
])

test('a seeded demo session is reproducible, identifiable and covers all five vetted families', () => {
  for (const seed of seeds) {
    const session = createDemoSession(seed)
    assert.deepEqual(session, createDemoSession(seed))
    assert.equal(session.seed, seed)
    assert.match(session.id, /^[A-F0-9]{8}$/)
    assert.equal(Number.parseInt(session.id, 16), seed)
    assert.equal(session.initialIncidents.length, 5)
    assert.equal(new Set(session.initialIncidents.map((incident) => incident.id)).size, 5)
    assert.deepEqual(session.initialIncidents.map((incident) => incident.templateId).sort(), Object.keys(scenarioDetails).sort())
    const times = session.initialIncidents.map((incident) => incident.time)
    assert.deepEqual(times, [...times].sort().reverse())
    for (const incident of session.initialIncidents) assert.match(incident.id, new RegExp(`^${session.id}-S00[1-5]$`))
  }
})

test('generated batches remain stable independently of generation order and have unique incident identities', () => {
  for (const seed of seeds) {
    const saved = createDemoIncident(seed, 50)
    createDemoIncident(seed, 1000)
    createDemoSession(seed)
    assert.deepEqual(createDemoIncident(seed, 50), saved)
    const incidents = Array.from({ length: 100 }, (_, index) => createDemoIncident(seed, index + 1))
    assert.equal(new Set(incidents.map((incident) => incident.id)).size, 100)
    const initialIds = createDemoSession(seed).initialIncidents.map((incident) => incident.id)
    assert.ok(incidents.every((incident) => !initialIds.includes(incident.id)))
  }
})

test('new seeds and batches vary report substance, not only row order or the displayed total', () => {
  const incidents = samples()
  for (const key of ['title', 'asset', 'regionCode', 'actor']) assert.ok(new Set(incidents.map((incident) => incident[key])).size >= 5, key)
  for (const familyId of Object.keys(scenarioDetails)) {
    const family = incidents.filter((incident) => incident.templateId === familyId)
    assert.ok(family.length >= 10)
    assert.ok(new Set(family.map((incident) => incident.title)).size >= 3)
    assert.ok(new Set(family.map((incident) => incident.details.summary)).size >= 10)
    assert.ok(new Set(family.map((incident) => incident.details.riskScore)).size >= 5)
    assert.ok(new Set(family.map((incident) => incident.time)).size >= 10)
    assert.ok(new Set(family.map((incident) => JSON.stringify(incident.details.actions))).size >= 5)
    assert.ok(new Set(family.map((incident) => JSON.stringify(incident.details.artifacts))).size >= 10)
  }
  const order = (seed) => createDemoSession(seed).initialIncidents.map((incident) => incident.templateId).join(',')
  assert.ok(new Set(seeds.map(order)).size >= 4)
  const generated = Array.from({ length: 50 }, (_, index) => createDemoIncident(123, index + 1))
  assert.ok(generated.some((incident, index) => index > 0 && incident.templateId === generated[index - 1].templateId), 'not a fixed family round robin')
  assert.ok(generated.some((incident, index) => index > 0 && incident.regionCode === generated[index - 1].regionCode), 'not a fixed map-region round robin')
})

test('every displayed asset, technique, source and evidence identifier agrees with its response dossier', () => {
  const expectedRegions = { na: 'NA', eu: 'EU', asia: 'APAC', sa: 'SA', af: 'AF', oc: 'OC' }
  for (const incident of samples()) {
    const { details } = incident
    assert.equal(expectedRegions[incident.regionCode], incident.region)
    assert.equal(field(details.indicators, 'Asset'), incident.asset)
    assert.ok(details.summary.includes(incident.asset))
    assert.equal(field(details.artifacts.file.fields, 'Exercise asset'), incident.asset)
    const [id, name] = details.techniques[0]
    assert.equal(incident.technique, `${id} ${name}`)
    assert.deepEqual(details.techniques, scenarioDetails[incident.templateId].techniques)
    assert.match(incident.actor, /^Synthetic /)
    assert.doesNotMatch(incident.actor, /APT|Lazarus|Sandworm|TA505/i)
    for (const value of JSON.stringify(details).match(/DEMO-[A-F0-9]{8}-[SE][A-Z0-9]+(?:-[A-Z]+-\d+)?/g) ?? []) {
      assert.ok(value.startsWith(`DEMO-${incident.id}`), value)
    }
    const primaryEvidence = field(details.indicators, 'Evidence')
    assert.ok(primaryEvidence.startsWith(`DEMO-${incident.id}-`))
    assert.ok(Object.values(details.artifacts).some((artifact) => artifact.fields.some(([, value]) => value === primaryEvidence)))
  }
})

test('all generated domains and IP addresses stay reserved for documentation', () => {
  for (const incident of samples()) {
    for (const ip of JSON.stringify(incident).match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? []) {
      assert.match(ip, /^(?:192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}$/)
      const host = Number(ip.split('.').at(-1))
      assert.ok(host >= 1 && host <= 254)
    }
    for (const [label, value] of incident.details.indicators) {
      if (/domain|url/i.test(label)) assert.match(value, /^demo-[a-z0-9-]+\.example$/)
    }
    for (const artifact of Object.values(incident.details.artifacts)) {
      for (const [label, value] of artifact.fields) if (/domain|sample endpoint/i.test(label)) assert.match(value, /\.example$/)
    }
  }
})

test('timeline clocks are coherent and the sample observation window matches its artifact metric', () => {
  for (const { details, time } of samples()) {
    const times = details.timeline.map((step) => step.time)
    assert.deepEqual(times, [...times].sort())
    assert.equal(time, times[2])
    for (const value of times) assert.match(value, /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/)
    const duration = (toSeconds(times[2]) - toSeconds(times[0])) / 60
    assert.ok(duration >= 4 && duration <= 24)
    const metric = Object.values(details.artifacts).flatMap((artifact) => artifact.fields).find(([, value]) => /minute fictional window/.test(value))
    assert.ok(metric)
    assert.ok(metric[1].includes(`/ ${duration}-minute fictional window`))
    assert.ok(details.timeline[1].copy.includes(`${duration}-minute synthetic window`))
  }
})

test('severity bands stay meaningful and containment is never represented as a real executed action', () => {
  const ranges = { critical: [85, 98], high: [65, 84], medium: [40, 64], low: [10, 35] }
  for (const incident of samples()) {
    const [minimum, maximum] = ranges[incident.severity]
    assert.ok(incident.details.riskScore >= minimum && incident.details.riskScore <= maximum)
    assert.match(incident.details.summary, /^Fictional /)
    assert.match(incident.status, /pending$/)
    assert.ok(incident.details.containment.some((step) => !step.done))
    assert.ok(incident.details.actions.length >= 3)
    assert.match(incident.details.timeline[1].copy, /No live collection was performed/)
    if (incident.templateId === 'C93-1204') assert.match(incident.details.summary, /modelled in the fixture only/)
  }
})

test('family-specific operating systems and evidence never cross into an unrelated report', () => {
  for (const incident of samples()) {
    const { details } = incident
    const data = JSON.stringify(details)
    if (['B16-9012', 'E09-7742'].includes(incident.templateId)) {
      assert.match(JSON.stringify(details.artifacts.registry.fields), /not applicable/i)
      assert.doesNotMatch(data, /WINWORD|powershell|HKLM|HKCU/)
    }
    if (incident.templateId === 'B16-9012') {
      assert.match(field(details.artifacts.file.fields, 'Sample file'), /\.log$/)
      assert.equal(field(details.indicators, 'Source IP'), field(details.artifacts.network.fields, 'Source IP'))
      assert.match(details.summary, /Successful access is unconfirmed/)
    }
    if (incident.templateId === 'C93-1204') {
      assert.equal(field(details.indicators, 'Domain'), field(details.artifacts.network.fields, 'Domain'))
      assert.equal(`${field(details.indicators, 'Destination IP')}:443`, field(details.artifacts.network.fields, 'Destination'))
      assert.equal(`${field(details.artifacts.file.fields, 'Sample file')} (sample)`, field(details.artifacts.process.fields, 'Process'))
    }
    if (incident.templateId === 'D44-6059') {
      assert.ok(field(details.artifacts.registry.fields, 'Key').endsWith(field(details.artifacts.process.fields, 'Service')))
      assert.equal(`${field(details.artifacts.file.fields, 'Sample file')} (sample)`, field(details.artifacts.process.fields, 'Process'))
    }
    if (incident.templateId === 'E09-7742') {
      assert.match(details.summary, /not evidence of data access/)
      assert.equal(field(details.indicators, 'Resource'), field(details.artifacts.file.fields, 'Resource'))
      assert.equal(field(details.indicators, 'Domain'), field(details.artifacts.network.fields, 'Sample endpoint'))
    }
  }
})

test('generation never mutates source fixtures, prior incidents or another session', () => {
  const templates = structuredClone(scenarioDetails)
  const first = createDemoSession(42)
  const saved = structuredClone(first)
  const event = createDemoIncident(42, 1)
  event.details.artifacts.file.fields[0][1] = 'mutated by a caller'
  first.initialIncidents[0].details.techniques[0][0] = 'modified'
  assert.deepEqual(scenarioDetails, templates)
  assert.deepEqual(createDemoSession(42), saved)
  assert.notEqual(createDemoIncident(42, 1).details.artifacts.file.fields[0][1], 'mutated by a caller')
})

test('initial and generated evidence namespaces cannot collide', () => {
  const session = createDemoSession(0)
  const initialFiles = session.initialIncidents.map((incident) => field(incident.details.artifacts.file.fields, 'Sample file'))
  for (let batch = 1; batch <= 5; batch++) {
    assert.ok(!initialFiles.includes(field(createDemoIncident(0, batch).details.artifacts.file.fields, 'Sample file')))
  }
})

test('out-of-contract seeds and batches are rejected instead of producing invalid fixture data', () => {
  for (const seed of [-1, 1.5, NaN, Infinity, -Infinity, 0x1_0000_0000, '1', null, undefined]) {
    assert.throws(() => createDemoSession(seed), RangeError)
    assert.throws(() => createDemoIncident(seed, 1), RangeError)
  }
  for (const batch of [-1, 0, 1.5, NaN, Infinity, -Infinity, 1_000_000_001, Number.MAX_SAFE_INTEGER, '1', null, undefined]) {
    assert.throws(() => createDemoIncident(42, batch), RangeError)
  }
  assert.ok(createDemoIncident(0xffffffff, 1_000_000_000).id)
})
