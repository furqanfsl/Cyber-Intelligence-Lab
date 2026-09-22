/** Fictional teaching fixtures only: no scanned hosts, executed actions or real IOCs. */
export type ScenarioId = 'A78-4319' | 'B16-9012' | 'C93-1204' | 'D44-6059' | 'E09-7742'
export type ArtifactTab = 'file' | 'network' | 'process' | 'registry'
export type ScenarioDetails = {
  riskScore: number
  phase: string
  summary: string
  indicators: Array<[string, string]>
  containment: Array<{ label: string; done: boolean }>
  timeline: Array<{ stage: string; time: string; copy: string; tone: 'critical' | 'high' | 'medium' | 'low' | 'success' }>
  techniques: Array<[string, string, string]>
  actions: Array<{ label: string; priority: 'High' | 'Medium' | 'Low' }>
  artifacts: Record<ArtifactTab, {
    label: string
    fields: Array<[string, string]>
    checklist: Array<[string, boolean]>
  }>
}

function artifact(label: string, fields: Array<[string, string]>, checklist: Array<[string, boolean]>) {
  return { label, fields, checklist }
}

// ATT&CK labels describe the exercise's subject, not a verified attacker attribution.
// References: https://attack.mitre.org/techniques/T1486/
// https://attack.mitre.org/techniques/T1110/ | https://attack.mitre.org/techniques/T1071/001/
// https://attack.mitre.org/techniques/T1068/ | https://attack.mitre.org/techniques/T1530/
export const scenarioDetails: Record<ScenarioId, ScenarioDetails> = {
  'A78-4319': {
    riskScore: 87,
    phase: 'Impact',
    summary: 'Fictional encryption alert on FIN-APP-01. Sample evidence supports an isolation exercise; this dashboard has not changed a host.',
    indicators: [
      ['Asset', 'FIN-APP-01'], ['Source IP', '192.0.2.42'],
      ['Domain', 'update-service.example'], ['Evidence', 'DEMO-A78-FILE-01'],
    ],
    containment: [
      { label: 'Capture sample host evidence', done: true },
      { label: 'Approve the isolation plan', done: false },
      { label: 'Validate a recovery checkpoint', done: false },
    ],
    timeline: [
      { stage: 'File activity', time: '14:12:03', tone: 'critical', copy: 'Sample file events show an encryption-like pattern on the finance application host.' },
      { stage: 'Evidence review', time: '14:21:16', tone: 'high', copy: 'The exercise document and process events are grouped for review.' },
      { stage: 'Alert selected', time: '14:27:11', tone: 'critical', copy: 'The fictional alert is ready for a containment decision.' },
      { stage: 'Plan prepared', time: '14:30:00', tone: 'medium', copy: 'Isolation and recovery checks remain proposed, not executed actions.' },
    ],
    techniques: [['T1486', 'Data Encrypted for Impact', 'Impact']],
    actions: [
      { label: 'Review host-isolation approval', priority: 'High' },
      { label: 'Preserve the sample process and file evidence', priority: 'High' },
      { label: 'Review recovery options in the exercise', priority: 'Medium' },
    ],
    artifacts: {
      file: artifact('File', [
        ['Sample file', 'invoice_7784.docm'], ['Evidence ID', 'DEMO-A78-FILE-01'],
        ['Example verdict', 'Suspicious document fixture'], ['Acquisition', 'Provided sample; not collected live'],
      ], [['Record sample provenance', true], ['Compare file-event sequence', true], ['Review recovery relevance', false]]),
      network: artifact('Network', [
        ['Source IP', '192.0.2.42'], ['Destination', '192.0.2.17:443'],
        ['Protocol', 'HTTPS in sample trace'], ['Disposition', 'Block proposed in exercise'],
      ], [['Review sample destination', true], ['Approve a simulated block rule', false], ['Validate expected traffic impact', false]]),
      process: artifact('Process', [
        ['Parent', 'WINWORD.EXE (sample)'], ['Child', 'powershell.exe (sample)'],
        ['Evidence ID', 'DEMO-A78-PROC-01'], ['Assessment', 'Illustrative document-to-process chain'],
      ], [['Preserve process sequence', true], ['Review child-process context', true], ['Approve containment decision', false]]),
      registry: artifact('Registry', [
        ['Hive', 'HKCU\\Software\\Microsoft\\Windows\\Run'], ['Sample value', 'DemoUpdater'],
        ['State', 'Persistence candidate in fixture'], ['Action', 'Removal not executed'],
      ], [['Record the sample value', true], ['Review whether it is authorized', false], ['Plan a reversible change', false]]),
    },
  },
  'B16-9012': {
    riskScore: 68,
    phase: 'Credential Access',
    summary: 'Fictional failed SSH logins on EDGE-GW-04. The sample does not establish a successful login; an identity-control review is queued.',
    indicators: [
      ['Asset', 'EDGE-GW-04'], ['Source IP', '198.51.100.18'],
      ['Service', 'SSH / TCP 22'], ['Evidence', 'DEMO-B16-AUTH-01'],
    ],
    containment: [
      { label: 'Review sample authentication failures', done: true },
      { label: 'Confirm identity-reset approval', done: false },
      { label: 'Review SSH access restrictions', done: false },
    ],
    timeline: [
      { stage: 'Login failures', time: '14:19:10', tone: 'high', copy: 'The sample gateway log contains repeated unsuccessful SSH authentication attempts.' },
      { stage: 'Pattern grouped', time: '14:23:42', tone: 'medium', copy: 'Events from the documentation source address are grouped for review.' },
      { stage: 'Alert selected', time: '14:26:58', tone: 'high', copy: 'The exercise raises a credential-access alert; successful access is unconfirmed.' },
      { stage: 'Review queued', time: '14:29:00', tone: 'medium', copy: 'Identity verification and access-policy checks remain pending.' },
    ],
    techniques: [['T1110', 'Brute Force', 'Credential Access']],
    actions: [
      { label: 'Check whether any sample login succeeded', priority: 'High' },
      { label: 'Review identity-reset and MFA requirements', priority: 'High' },
      { label: 'Evaluate SSH rate limits and access rules', priority: 'Medium' },
    ],
    artifacts: {
      file: artifact('File', [
        ['Sample file', '/var/log/auth.log (excerpt)'], ['Evidence ID', 'DEMO-B16-AUTH-01'],
        ['Event type', 'Failed SSH authentication'], ['Scope', 'Fictional Linux gateway'],
      ], [['Preserve the sample log window', true], ['Check for successful logins', false], ['Verify account ownership', false]]),
      network: artifact('Network', [
        ['Source IP', '198.51.100.18'], ['Destination', '192.0.2.44:22'],
        ['Protocol', 'SSH / TCP'], ['Disposition', 'Access-rule review pending'],
      ], [['Group the sample source events', true], ['Review authorized source ranges', false], ['Assess a rate-limit change', false]]),
      process: artifact('Process', [
        ['Service', 'sshd (sample)'], ['Asset', 'EDGE-GW-04'],
        ['Evidence', 'Authentication failures, not a malicious process'], ['Session state', 'Successful session unconfirmed'],
      ], [['Identify the service context', true], ['Compare session and auth logs', false], ['Check expected service configuration', false]]),
      registry: artifact('Registry', [
        ['Scope', 'Not applicable: Linux SSH gateway'], ['Alternative evidence', 'SSH configuration snapshot'],
        ['Persistence finding', 'Not established in this exercise'], ['Boundary', 'No Windows registry evidence supplied'],
      ], [['Identify the operating-system scope', true], ['Review the relevant SSH configuration', false]]),
    },
  },
  'C93-1204': {
    riskScore: 76,
    phase: 'Command and Control',
    summary: 'Fictional periodic HTTPS traffic on HR-WKS-17. Isolation is marked active in the fixture; no endpoint or network rule is controlled here.',
    indicators: [
      ['Asset', 'HR-WKS-17'], ['Destination IP', '203.0.113.73'],
      ['Domain', 'relay-node.example'], ['Evidence', 'DEMO-C93-NET-01'],
    ],
    containment: [
      { label: 'Review sample beacon timing', done: true },
      { label: 'Mark isolation in the exercise', done: true },
      { label: 'Validate the proposed destination rule', done: false },
    ],
    timeline: [
      { stage: 'Pattern observed', time: '14:15:04', tone: 'high', copy: 'The sample trace shows recurring HTTPS connections to a reserved endpoint.' },
      { stage: 'Context checked', time: '14:22:09', tone: 'medium', copy: 'The fictional workstation process is correlated with the traffic pattern.' },
      { stage: 'Alert selected', time: '14:26:41', tone: 'high', copy: 'The exercise flags possible command-and-control behavior, not verified live traffic.' },
      { stage: 'Isolation modelled', time: '14:28:30', tone: 'success', copy: 'The fixture marks host isolation active; a destination-rule review is still pending.' },
    ],
    techniques: [['T1071.001', 'Web Protocols', 'Command and Control']],
    actions: [
      { label: 'Review the sample process-to-network relationship', priority: 'High' },
      { label: 'Validate the exercise isolation decision', priority: 'High' },
      { label: 'Compare beacon timing with legitimate applications', priority: 'Medium' },
    ],
    artifacts: {
      file: artifact('File', [
        ['Sample file', 'demo-agent.exe'], ['Evidence ID', 'DEMO-C93-FILE-01'],
        ['Asset', 'HR-WKS-17'], ['Reputation', 'Not independently verified'],
      ], [['Preserve the sample file reference', true], ['Review approved-software inventory', false], ['Document classification rationale', false]]),
      network: artifact('Network', [
        ['Source IP', '192.0.2.117'], ['Destination', '203.0.113.73:443'],
        ['Domain', 'relay-node.example'], ['Pattern', 'Periodic HTTPS in sample trace'],
      ], [['Compare sample connection intervals', true], ['Correlate the originating process', true], ['Validate the proposed deny rule', false]]),
      process: artifact('Process', [
        ['Process', 'demo-agent.exe (sample)'], ['Asset', 'HR-WKS-17'],
        ['Evidence ID', 'DEMO-C93-PROC-01'], ['Assessment', 'Process context requires review'],
      ], [['Link sample process and traffic', true], ['Check expected application behavior', false], ['Record the review decision', false]]),
      registry: artifact('Registry', [
        ['Scope', 'Windows workstation fixture'], ['Run-key finding', 'No persistence entry supplied'],
        ['Evidence state', 'Not collected in this sample'], ['Next check', 'Review persistence only if justified'],
      ], [['Record the evidence gap', true], ['Define a proportionate follow-up check', false]]),
    },
  },
  'D44-6059': {
    riskScore: 52,
    phase: 'Privilege Escalation',
    summary: 'Fictional privilege-escalation attempt on ENG-BUILD-02. Sample evidence is captured, but elevated access and a specific exploit are unconfirmed.',
    indicators: [
      ['Asset', 'ENG-BUILD-02'], ['Host IP', '192.0.2.62'],
      ['Event', 'Privilege boundary review'], ['Evidence', 'DEMO-D44-PROC-01'],
    ],
    containment: [
      { label: 'Capture the sample service events', done: true },
      { label: 'Verify the effective privilege level', done: false },
      { label: 'Approve a reversible mitigation', done: false },
    ],
    timeline: [
      { stage: 'Service event', time: '14:11:21', tone: 'medium', copy: 'The fixture includes a service event crossing an expected privilege boundary.' },
      { stage: 'Evidence saved', time: '14:20:35', tone: 'success', copy: 'Sample process and service-configuration references are available for review.' },
      { stage: 'Alert selected', time: '14:25:38', tone: 'medium', copy: 'The exercise marks a possible escalation attempt; success is not established.' },
      { stage: 'Review pending', time: '14:28:00', tone: 'medium', copy: 'Privilege validation and a change-approved mitigation remain outstanding.' },
    ],
    techniques: [['T1068', 'Exploitation for Privilege Escalation', 'Privilege Escalation']],
    actions: [
      { label: 'Verify the sample process privilege context', priority: 'High' },
      { label: 'Compare service configuration with its baseline', priority: 'Medium' },
      { label: 'Plan an approved mitigation and rollback', priority: 'Medium' },
    ],
    artifacts: {
      file: artifact('File', [
        ['Sample file', 'build-worker.exe'], ['Evidence ID', 'DEMO-D44-FILE-01'],
        ['Asset', 'ENG-BUILD-02'], ['Verification', 'Integrity comparison pending'],
      ], [['Record the sample binary reference', true], ['Compare the approved build artifact', false], ['Review signing and provenance', false]]),
      network: artifact('Network', [
        ['Host IP', '192.0.2.62'], ['External destination', 'None supplied in this fixture'],
        ['Scope', 'Local service activity'], ['Finding', 'No network compromise established'],
      ], [['Record the local-only evidence scope', true], ['Request network context if warranted', false]]),
      process: artifact('Process', [
        ['Service', 'DemoBuildWorker'], ['Process', 'build-worker.exe (sample)'],
        ['Evidence ID', 'DEMO-D44-PROC-01'], ['Effective privilege', 'Requires analyst validation'],
      ], [['Preserve sample service events', true], ['Validate the privilege boundary', false], ['Review the owning service account', false]]),
      registry: artifact('Registry', [
        ['Key', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\DemoBuildWorker'], ['Scope', 'Sample service configuration'],
        ['Baseline', 'Approved comparison pending'], ['Action', 'No configuration changes executed'],
      ], [['Capture the sample configuration', true], ['Compare authorized service permissions', false], ['Plan a reversible change if required', false]]),
    },
  },
  'E09-7742': {
    riskScore: 24,
    phase: 'Exposure review',
    summary: 'Fictional access-policy drift on S3-LOG-ARCHIVE. This is a configuration review, not evidence of data access or a confirmed attacker.',
    indicators: [
      ['Asset', 'S3-LOG-ARCHIVE'], ['Resource', 'demo-log-archive'],
      ['Domain', 'storage-policy.example'], ['Evidence', 'DEMO-E09-POLICY-01'],
    ],
    containment: [
      { label: 'Record the sample policy difference', done: true },
      { label: 'Approve the least-privilege correction', done: false },
      { label: 'Validate the intended access boundary', done: false },
    ],
    timeline: [
      { stage: 'Policy difference', time: '14:10:12', tone: 'low', copy: 'The sample bucket policy differs from its intended access baseline.' },
      { stage: 'Scope reviewed', time: '14:19:40', tone: 'low', copy: 'The exercise records configuration exposure, not evidence of object access.' },
      { stage: 'Alert selected', time: '14:24:59', tone: 'low', copy: 'The fictional policy finding is assigned for owner review.' },
      { stage: 'Change proposed', time: '14:27:00', tone: 'medium', copy: 'A least-privilege correction is awaiting approval and validation.' },
    ],
    techniques: [['T1530', 'Data from Cloud Storage', 'Collection']],
    actions: [
      { label: 'Confirm the intended bucket access policy', priority: 'Medium' },
      { label: 'Review a least-privilege correction with the owner', priority: 'Medium' },
      { label: 'Validate access after the approved change', priority: 'Low' },
    ],
    artifacts: {
      file: artifact('File', [
        ['Sample file', 'bucket-policy.before.json'], ['Evidence ID', 'DEMO-E09-POLICY-01'],
        ['Resource', 'demo-log-archive'], ['Finding', 'Illustrative policy drift, not malware'],
      ], [['Preserve the policy comparison', true], ['Confirm the intended permissions', false], ['Review the proposed policy revision', false]]),
      network: artifact('Network', [
        ['Scope', 'Cloud control-plane policy review'], ['Sample endpoint', 'storage-policy.example'],
        ['Traffic capture', 'Not supplied in this exercise'], ['Data access', 'No access or transfer established'],
      ], [['Record the limits of the sample', true], ['Review access logs if authorized', false]]),
      process: artifact('Process', [
        ['Scope', 'Not applicable: managed cloud storage'], ['Alternative evidence', 'Policy change audit event'],
        ['Host process', 'No endpoint process represented'], ['Review owner', 'Cloud resource owner in exercise'],
      ], [['Identify the cloud control-plane scope', true], ['Review the sample policy-change actor', false]]),
      registry: artifact('Registry', [
        ['Scope', 'Not applicable: managed cloud storage'], ['Alternative evidence', 'Bucket policy and access settings'],
        ['Host registry', 'No Windows host in this scenario'], ['Next check', 'Validate the approved access boundary'],
      ], [['Use resource-policy evidence instead', true], ['Validate the intended cloud permissions', false]]),
    },
  },
}
