import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scenarioDetails } from '../../src/data/scenarios.ts'

const expected = {
  'A78-4319': ['FIN-APP-01', 'T1486', 'Impact'],
  'B16-9012': ['EDGE-GW-04', 'T1110', 'Credential Access'],
  'C93-1204': ['HR-WKS-17', 'T1071.001', 'Command and Control'],
  'D44-6059': ['ENG-BUILD-02', 'T1068', 'Privilege Escalation'],
  'E09-7742': ['S3-LOG-ARCHIVE', 'T1530', 'Collection'],
}

test('every selectable alert has a distinct, explicitly fictional response dossier', () => {
  assert.deepEqual(Object.keys(scenarioDetails).sort(), Object.keys(expected).sort())
  assert.equal(new Set(Object.values(scenarioDetails).map((scenario) => scenario.summary)).size, 5)
  for (const [id, [asset]] of Object.entries(expected)) {
    assert.match(scenarioDetails[id].summary, /fictional/i)
    assert.ok(scenarioDetails[id].summary.includes(asset), id)
  }
})

test('scenario risk and technique mappings match the selected incident rather than a fixed ransomware template', () => {
  for (const [id, [, technique, tactic]] of Object.entries(expected)) {
    const scenario = scenarioDetails[id]
    assert.ok(Number.isInteger(scenario.riskScore) && scenario.riskScore >= 0 && scenario.riskScore <= 100)
    assert.equal(scenario.techniques[0][0], technique, id)
    assert.equal(scenario.techniques[0][2], tactic, id)
    assert.ok(scenario.phase.length > 0)
  }
  assert.ok(scenarioDetails['A78-4319'].riskScore > scenarioDetails['C93-1204'].riskScore)
  assert.ok(scenarioDetails['C93-1204'].riskScore > scenarioDetails['D44-6059'].riskScore)
  assert.ok(scenarioDetails['D44-6059'].riskScore > scenarioDetails['E09-7742'].riskScore)
  assert.notEqual(scenarioDetails['E09-7742'].phase, 'Lateral movement')
})

test('each dossier provides chronological, labelled timeline steps and unfinished response work', () => {
  const tones = new Set(['critical', 'high', 'medium', 'low', 'success'])
  for (const [id, scenario] of Object.entries(scenarioDetails)) {
    assert.ok(scenario.timeline.length >= 3, id)
    const times = scenario.timeline.map((step) => step.time)
    assert.deepEqual(times, [...times].sort(), id)
    for (const step of scenario.timeline) {
      assert.match(step.time, /^\d{2}:\d{2}:\d{2}$/)
      assert.ok(step.stage && step.copy && tones.has(step.tone), id)
    }
    assert.ok(scenario.containment.some((step) => step.done === false), id)
    for (const step of scenario.containment) assert.ok(step.label && typeof step.done === 'boolean', id)
    assert.ok(scenario.actions.length >= 3, id)
    for (const action of scenario.actions) assert.ok(action.label && ['High', 'Medium', 'Low'].includes(action.priority), id)
  }
})

test('all four artifact tabs have scenario-specific labels, fields and checklist content', () => {
  const labels = { file: 'File', network: 'Network', process: 'Process', registry: 'Registry' }
  const artifacts = Object.values(scenarioDetails).map((scenario) => JSON.stringify(scenario.artifacts))
  assert.equal(new Set(artifacts).size, 5)
  for (const scenario of Object.values(scenarioDetails)) {
    assert.deepEqual(Object.keys(scenario.artifacts).sort(), Object.keys(labels).sort())
    for (const [tab, artifact] of Object.entries(scenario.artifacts)) {
      assert.equal(artifact.label, labels[tab])
      assert.ok(artifact.fields.length >= 3)
      for (const [label, value] of artifact.fields) assert.ok(label && value)
      assert.ok(artifact.checklist.length >= 2)
      for (const [label, done] of artifact.checklist) assert.ok(label && typeof done === 'boolean')
    }
  }
})

test('all literal addresses are reserved documentation IPs and domains use example names', () => {
  const data = JSON.stringify(scenarioDetails)
  for (const ip of data.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? []) {
    assert.match(ip, /^(?:192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}$/, ip)
  }
  for (const scenario of Object.values(scenarioDetails)) {
    for (const [label, value] of scenario.indicators) {
      if (/domain|url/i.test(label)) assert.match(value, /\.example(?:\b|\/)/, value)
    }
  }
})

test('SSH and cloud cases do not fabricate Windows registry or ransomware evidence', () => {
  for (const id of ['B16-9012', 'E09-7742']) {
    assert.match(scenarioDetails[id].artifacts.registry.fields.flat().join(' '), /not applicable/i)
    assert.doesNotMatch(JSON.stringify(scenarioDetails[id]), /invoice_7784|WINWORD|rundll32|3 hosts isolated/i)
  }
  assert.match(scenarioDetails['E09-7742'].summary, /not evidence of data access/i)
})
