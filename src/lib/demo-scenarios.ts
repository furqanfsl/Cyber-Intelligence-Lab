import { scenarioDetails } from '../data/scenarios.ts'
import type { ArtifactTab, ScenarioDetails, ScenarioId } from '../data/scenarios.ts'

export type Severity = 'critical' | 'high' | 'medium' | 'low'
export type DemoRegionCode = 'na' | 'eu' | 'asia' | 'sa' | 'af' | 'oc'
export type DemoIncident = {
  id: string
  templateId: ScenarioId
  time: string
  title: string
  severity: Severity
  region: string
  regionCode: DemoRegionCode
  actor: string
  vector: string
  asset: string
  technique: string
  status: string
  details: ScenarioDetails
}
export type DemoSession = { seed: number; id: string; initialIncidents: DemoIncident[] }

// Pure, reproducible teaching data. No remote calls, real addresses or actor attribution.
// A session never mutates the vetted fixtures; each incident owns a separate dossier.
const regions: Array<{ code: DemoRegionCode; label: string }> = [
  { code: 'na', label: 'NA' }, { code: 'eu', label: 'EU' },
  { code: 'asia', label: 'APAC' }, { code: 'sa', label: 'SA' },
  { code: 'af', label: 'AF' }, { code: 'oc', label: 'OC' },
]

type Family = {
  templateId: ScenarioId
  severity: Severity
  titles: string[]
  assets: string[]
  oldAsset: string
  oldFile: string
  files: string[]
  extension: string
  pattern: string
  vector: string
  status: string
  metric: string
  metricTab: ArtifactTab
  summaries: string[]
  boundary: string
  observations: string[]
  reviews: string[]
}

const families: Family[] = [
  {
    templateId: 'A78-4319', severity: 'critical',
    titles: ['Ransomware activity detected', 'Encryption-like file changes', 'Document-triggered encryption pattern'],
    assets: ['FIN-APP', 'PAYROLL-SRV', 'LEDGER-APP'], oldAsset: 'FIN-APP-01',
    oldFile: 'invoice_7784.docm', files: ['invoice', 'payment_notice', 'account_review'], extension: 'docm',
    pattern: 'Synthetic document-chain pattern', vector: 'Document / execution chain', status: 'Isolation approval pending',
    metric: 'Sample file-change events', metricTab: 'file',
    summaries: [
      'Fictional encryption-like activity on {asset}: {count} file-change events follow the sample document {file} within {minutes} minutes.',
      'Fictional document-to-process chain on {asset}. The {minutes}-minute evidence window groups {count} file changes for an encryption-impact review.',
      'Fictional recovery exercise on {asset}: {count} sample file changes are associated with {file}, not a confirmed live infection.',
    ],
    boundary: 'Isolation and recovery remain proposed; no host has been changed.',
    observations: ['The fixture groups {count} file changes on {asset} after the sample document was opened.', 'The synthetic {minutes}-minute file timeline links {file} to an encryption-like pattern.'],
    reviews: ['Compare the {count} file changes with the approved application workload', 'Check the recovery checkpoint for {asset}', 'Review the provenance of {file} before an isolation decision'],
  },
  {
    templateId: 'B16-9012', severity: 'high',
    titles: ['Multiple failed SSH attempts', 'Repeated gateway authentication failures', 'SSH credential-guessing pattern'],
    assets: ['EDGE-GW', 'ACCESS-GW', 'BASTION-LNX'], oldAsset: 'EDGE-GW-04',
    oldFile: '/var/log/auth.log (excerpt)', files: ['auth-window', 'ssh-failures', 'gateway-auth'], extension: 'log',
    pattern: 'Synthetic credential-guessing pattern', vector: 'SSH / credential access', status: 'Access review pending',
    metric: 'Sample failed logins', metricTab: 'network',
    summaries: [
      'Fictional failed SSH logins on {asset}: {count} unsuccessful attempts from {sourceIp} span {minutes} minutes.',
      'Fictional gateway-access exercise on {asset}. A {minutes}-minute log excerpt contains {count} failed authentications from {sourceIp}.',
      'Fictional credential-guessing pattern against {asset}: {count} SSH failures are grouped in {file} for identity review.',
    ],
    boundary: 'Successful access is unconfirmed; identity and access-policy changes await approval.',
    observations: ['The sample log records {count} unsuccessful SSH authentications to {asset}.', 'The fictional gateway groups failures from documentation address {sourceIp} across {minutes} minutes.'],
    reviews: ['Compare {count} failures with the gateway access baseline', 'Review whether {sourceIp} represents an authorized source in the exercise', 'Check successful-login records before proposing an identity reset'],
  },
  {
    templateId: 'C93-1204', severity: 'high',
    titles: ['Command and control beacon', 'Periodic outbound HTTPS pattern', 'Unusual workstation callback cadence'],
    assets: ['HR-WKS', 'OPS-WKS', 'SALES-WKS'], oldAsset: 'HR-WKS-17',
    oldFile: 'demo-agent.exe', files: ['demo-agent', 'demo-sync', 'demo-helper'], extension: 'exe',
    pattern: 'Synthetic callback pattern', vector: 'HTTPS / application-layer channel', status: 'Destination-rule review pending',
    metric: 'Sample HTTPS callbacks', metricTab: 'network',
    summaries: [
      'Fictional periodic HTTPS traffic on {asset}: {count} callbacks to {domain} occur within {minutes} minutes.',
      'Fictional beacon-analysis exercise on {asset}. The sample process {file} is associated with {count} HTTPS callbacks to {destinationIp}.',
      'Fictional callback-cadence finding on {asset}: {count} sample connections to {domain} require comparison with legitimate application behavior.',
    ],
    boundary: 'Isolation is modelled in the fixture only; no endpoint or network rule is controlled here.',
    observations: ['The synthetic trace includes {count} HTTPS callbacks from {asset} to {domain}.', 'The sample process {file} is linked to a repeating {minutes}-minute traffic window.'],
    reviews: ['Compare the {count} callbacks with expected application activity', 'Review the approved-software context of {file}', 'Check ownership of the synthetic destination before proposing a deny rule'],
  },
  {
    templateId: 'D44-6059', severity: 'medium',
    titles: ['Privilege escalation attempt', 'Service privilege-boundary anomaly', 'Unexpected build-worker permission change'],
    assets: ['ENG-BUILD', 'CI-WORKER', 'BUILD-AGENT'], oldAsset: 'ENG-BUILD-02',
    oldFile: 'build-worker.exe', files: ['demo-build-worker', 'demo-ci-agent', 'demo-job-runner'], extension: 'exe',
    pattern: 'Synthetic service-boundary pattern', vector: 'Local service / privilege boundary', status: 'Privilege validation pending',
    metric: 'Sample service events', metricTab: 'process',
    summaries: [
      'Fictional privilege-boundary review on {asset}: {count} service events around {file} span {minutes} minutes.',
      'Fictional build-service anomaly on {asset}. The exercise groups {count} process and configuration events for effective-privilege validation.',
      'Fictional escalation attempt on {asset}: {count} sample service events differ from the expected baseline around {file}.',
    ],
    boundary: 'Elevated access and a specific exploit are unconfirmed; no mitigation has been executed.',
    observations: ['The fixture includes {count} service-boundary events involving {file} on {asset}.', 'The synthetic {minutes}-minute service timeline is ready for a privilege-context comparison.'],
    reviews: ['Compare the {count} service events with an approved configuration', 'Verify the effective privilege of {file}', 'Review the service owner before planning a reversible change'],
  },
  {
    templateId: 'E09-7742', severity: 'low',
    titles: ['Policy violation on cloud bucket', 'Cloud storage access-policy drift', 'Storage permission baseline mismatch'],
    assets: ['S3-LOG', 'S3-AUDIT', 'S3-ARCHIVE'], oldAsset: 'S3-LOG-ARCHIVE',
    oldFile: 'bucket-policy.before.json', files: ['bucket-policy', 'access-policy', 'storage-baseline'], extension: 'json',
    pattern: 'Synthetic configuration-drift pattern', vector: 'Cloud policy / public exposure', status: 'Policy approval pending',
    metric: 'Sample policy differences', metricTab: 'file',
    summaries: [
      'Fictional access-policy drift on {asset}: {count} permission differences are grouped in {file} for owner review.',
      'Fictional cloud-storage exercise on {asset}. A {minutes}-minute audit window highlights {count} differences from the intended access policy.',
      'Fictional permission-baseline review on {asset}: {count} policy differences affect the sample resource {resource}.',
    ],
    boundary: 'This is a configuration review, not evidence of data access or a confirmed attacker. Changes await owner approval.',
    observations: ['The sample policy on {asset} contains {count} differences from its intended access baseline.', 'The fictional resource {resource} is assigned for review of {count} access-policy differences.'],
    reviews: ['Confirm the intended permissions for {resource}', 'Review {count} policy differences with the exercise resource owner', 'Plan a least-privilege correction with a reversible validation step'],
  },
]

function validateSeed(seed: number) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw new RangeError('Demo seed must be an unsigned 32-bit integer')
}

// Mulberry32 is for varied demo fixtures, not passwords, tokens or security decisions.
function randomFrom(seed: number, index: number) {
  let state = (seed ^ Math.imul(index, 0x9e3779b1)) >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), state | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000
  }
}

function shuffle<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1))
    ;[result[index], result[target]] = [result[target], result[index]]
  }
  return result
}

function clock(seconds: number) {
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((part) => String(part).padStart(2, '0')).join(':')
}

function incident(seed: number, sequence: number, initialFamily?: Family): DemoIncident {
  const random = randomFrom(seed, sequence)
  const pick = <T,>(values: readonly T[]) => values[Math.floor(random() * values.length)]
  const integer = (minimum: number, maximum: number) => minimum + Math.floor(random() * (maximum - minimum + 1))
  const family = initialFamily ?? pick(families)
  const id = `${seed.toString(16).padStart(8, '0').toUpperCase()}-${initialFamily ? 'S' : 'E'}${Math.abs(sequence).toString(36).toUpperCase().padStart(3, '0')}`
  const suffix = `${seed.toString(36)}-${initialFamily ? 's' : 'e'}${Math.abs(sequence).toString(36)}`
  const asset = `${pick(family.assets)}-${integer(10, 99)}`
  const file = `${pick(family.files)}-${suffix}.${family.extension}`
  const region = pick(regions)
  const sourceIp = `198.51.100.${integer(1, 254)}`
  const hostIp = `192.0.2.${integer(1, 254)}`
  const destinationIp = `203.0.113.${integer(1, 254)}`
  const domain = `demo-${suffix}.example`
  const resource = `demo-storage-${suffix}`
  const service = `DemoWorker${Math.abs(sequence)}_${seed.toString(36)}`
  const count = integer(8, family.severity === 'low' ? 24 : 180)
  const minutes = integer(4, 24)
  const start = integer(8 * 3600, 18 * 3600)
  const duration = minutes * 60
  const evidence = `DEMO-${id}`
  const details = structuredClone(scenarioDetails[family.templateId])
  const replacements: Array<[string, string]> = [
    [family.oldAsset, asset], [family.oldFile, file],
    [`DEMO-${family.templateId.slice(0, 3)}-`, `${evidence}-`],
    ['DemoBuildWorker', service], ['DemoUpdater', `DemoUpdater_${suffix}`],
    ['update-service.example', domain], ['relay-node.example', domain], ['storage-policy.example', domain],
    ['demo-log-archive', resource],
    ['192.0.2.42', sourceIp], ['198.51.100.18', sourceIp], ['192.0.2.117', hostIp], ['192.0.2.62', hostIp],
    ['192.0.2.17', destinationIp], ['192.0.2.44', hostIp], ['203.0.113.73', destinationIp],
  ]
  // One replacement pass prevents newly generated addresses/identifiers being rewritten.
  const pattern = new RegExp(replacements.map(([from]) => from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length).join('|'), 'g')
  const lookup = new Map(replacements)
  const replace = (value: string) => value.replace(pattern, (match) => lookup.get(match)!)
  const context: Record<string, string> = { asset, file, sourceIp, destinationIp, domain, resource, count: String(count), minutes: String(minutes) }
  const fill = (value: string) => value.replace(/\{(\w+)\}/g, (_, key: string) => context[key])

  const riskRanges: Record<Severity, [number, number]> = { critical: [85, 98], high: [65, 84], medium: [40, 64], low: [10, 35] }
  details.riskScore = integer(...riskRanges[family.severity])
  details.summary = `${fill(pick(family.summaries))} ${family.boundary}`
  details.indicators = details.indicators.map(([label, value]) => [label, replace(value)])
  details.containment = details.containment.map((step) => ({ ...step, label: replace(step.label) }))
  details.containment[0].label = `Record the sample evidence for ${asset}`
  details.timeline = details.timeline.map((step, index) => ({
    ...step, time: clock(start + [0, Math.floor(duration / 2), duration, duration + 120][index]), copy: replace(step.copy),
  }))
  details.timeline[0].copy = fill(pick(family.observations))
  details.timeline[1].copy = `Evidence ${evidence} groups the ${minutes}-minute synthetic window for ${asset}. No live collection was performed.`
  details.timeline[2].copy = `The fictional ${family.severity}-severity finding on ${asset} is ready for review. ${family.boundary}`
  details.actions = shuffle(details.actions.map((action, index) => ({
    ...action, label: index === 1 ? fill(pick(family.reviews)) : replace(action.label),
  })), random)
  for (const artifact of Object.values(details.artifacts)) {
    artifact.fields = artifact.fields.map(([label, value]) => [label, replace(value)])
    artifact.checklist = artifact.checklist.map(([label, done]) => [replace(label), done])
  }
  const primaryEvidence = details.indicators.find(([label]) => label === 'Evidence')![1]
  if (!details.artifacts[family.metricTab].fields.some(([, value]) => value === primaryEvidence)) {
    details.artifacts[family.metricTab].fields.push(['Evidence ID', primaryEvidence])
  }
  details.artifacts[family.metricTab].fields.push([family.metric, `${count} / ${minutes}-minute fictional window`])
  details.artifacts[family.metricTab].checklist[0][0] = `Record the ${count}-event sample window for ${asset}`
  // Templates may describe a supplied artifact without a host field; keep asset provenance explicit.
  details.artifacts.file.fields.push(['Exercise asset', asset])
  const [techniqueId, techniqueLabel] = details.techniques[0]
  return {
    id, templateId: family.templateId, time: details.timeline[2].time,
    title: pick(family.titles), severity: family.severity, region: region.label, regionCode: region.code,
    actor: family.pattern, vector: family.vector, asset, technique: `${techniqueId} ${techniqueLabel}`,
    status: family.status, details,
  }
}

export function createDemoSession(seed: number): DemoSession {
  validateSeed(seed)
  const initialIncidents = shuffle(families, randomFrom(seed, 0))
    .map((family, index) => incident(seed, -(index + 1), family))
    .sort((left, right) => right.time.localeCompare(left.time))
  return { seed, id: seed.toString(16).padStart(8, '0').toUpperCase(), initialIncidents }
}

/** Random access stays O(1), even for a long-running session; callers bound retained rows. */
export function createDemoIncident(seed: number, batch: number): DemoIncident {
  validateSeed(seed)
  if (!Number.isSafeInteger(batch) || batch < 1 || batch > 1_000_000_000) throw new RangeError('Demo batch must be an integer between 1 and 1000000000')
  return incident(seed, batch)
}
