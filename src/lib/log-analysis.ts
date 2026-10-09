/** Offline, bounded Windows event analysis. No network requests or machine access. */
export type LogEvent = {
  id: string
  timestamp: string
  host: string
  channel: 'Security' | 'Sysmon'
  eventId: number
  user: string
  sourceIp: string
  process: string
  commandLine: string
}

export type DetectionAlert = {
  id: string
  ruleId: string
  title: string
  severity: 'high' | 'medium'
  summary: string
  evidenceIds: string[]
  firstSeen: string
  lastSeen: string
  nextSteps: string[]
  falsePositives: string[]
}

export type LogDataset = {
  events: LogEvent[]
  warnings: string[]
  duplicateCount: number
  unsupportedCount: number
}

export const MAX_LOG_BYTES = 5 * 1024 * 1024
export const MAX_LOG_RECORDS = 10_000
const WINDOW_MS = 5 * 60 * 1000
const SUCCESS_WINDOW_MS = 10 * 60 * 1000
const encoder = new TextEncoder()
const FIELD_BYTES = { host: 256, user: 256, sourceIp: 128, process: 1024, commandLine: 8192 } as const
const SYSMON_CHANNEL = 'Microsoft-Windows-Sysmon/Operational'

export const DETECTION_RULES = [
  {
    id: 'R001',
    title: 'Repeated failed logons',
    description: 'At least five Security 4625 failures for the same host, user and observed source IP within an inclusive five-minute window.',
    limitations: [
      'A contiguous burst ends only when adjacent failures are more than five minutes apart. One alert uses the first qualifying five-event proof, not every later failure in the burst.',
      'Missing users or source IPs are excluded. Identity strings must match exactly; aliases, casing differences and shared addresses can affect correlation.',
      'Mistyped passwords, expired credentials and configured retries can trigger this rule. A match is not proof of an attack.',
    ],
  },
  {
    id: 'R002',
    title: 'Successful logon after repeated failures',
    description: 'A Security 4624 success strictly after five same-identity failures in five minutes, no more than ten minutes after the final qualifying failure.',
    limitations: [
      'One alert per successful event uses the latest qualifying five-failure proof. Failures sharing the success timestamp are excluded because ordering is unknown; an earlier qualifying window can still match.',
      'Missing users or source IPs are excluded. Same host, user and observed source IP strings must match exactly.',
      'A legitimate user correcting a password can trigger this sequence. Logon type, authentication details and context require manual review.',
    ],
  },
  {
    id: 'R003',
    title: 'Encoded PowerShell command',
    description: 'A Sysmon event 1 identifies powershell or pwsh with an -enc or -encodedcommand argument, case-insensitively.',
    limitations: [
      'Requires a process-creation event with both the executable and command line. Other abbreviations, evasion techniques and missing telemetry are not covered.',
      'Encoded commands are also used by legitimate administration and deployment tools. This rule does not decode or execute the command.',
    ],
  },
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string') throw new Error('timestamp must be an ISO date-time with an explicit UTC or numeric offset.')
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match) throw new Error('timestamp must be an ISO date-time with an explicit UTC or numeric offset.')
  const [, year, month, day, hour, minute, second, fraction = '', zone] = match
  const calendar = new Date(`${year}-${month}-${day}T00:00:00.000Z`)
  if (Number(year) < 1 || calendar.getUTCFullYear() !== Number(year) || calendar.getUTCMonth() + 1 !== Number(month) || calendar.getUTCDate() !== Number(day) ||
      Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 ||
      (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))) {
    throw new Error('timestamp contains an invalid calendar date, time or offset.')
  }
  const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.${fraction.slice(0, 3).padEnd(3, '0')}${zone}`)
  if (!Number.isFinite(parsed.getTime())) throw new Error('timestamp is not a valid date-time.')
  if (parsed.getUTCFullYear() < 1 || parsed.getUTCFullYear() > 9999) throw new Error('timestamp must normalize to UTC within years 0001 through 9999.')
  return parsed.toISOString()
}

function textField(value: unknown, field: keyof typeof FIELD_BYTES): string {
  if (value === undefined || value === null) value = ''
  if (typeof value !== 'string') throw new Error(`${field} must be text.`)
  const clean = value.trim()
  // Unicode mode treats valid UTF-16 pairs as one scalar, leaving only lone surrogates here.
  if (/[\uD800-\uDFFF]/u.test(clean)) throw new Error(`${field} contains invalid Unicode.`)
  if (encoder.encode(clean).byteLength > FIELD_BYTES[field]) throw new Error(`${field} exceeds its ${FIELD_BYTES[field]}-byte text limit.`)
  if (/\p{Cc}/u.test(clean.replace(field === 'commandLine' ? /[\t\r\n]/g : /\t/g, ''))) {
    throw new Error(`${field} contains unsupported control characters.`)
  }
  return field !== 'host' && clean === '-' ? '' : clean
}

/** Two independent 32-bit FNV-1a accumulators. Deduplication uses the full key, not this digest. */
function stableId(prefix: string, parts: (string | number)[]): string {
  let first = 2166136261
  let second = 2246822507
  for (const byte of encoder.encode(JSON.stringify(parts))) {
    first = Math.imul(first ^ byte, 16777619) >>> 0
    second = Math.imul(second ^ byte, 16777619) >>> 0
  }
  return `${prefix}-${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`
}

function eventParts(event: Omit<LogEvent, 'id'>): (string | number)[] {
  return [event.timestamp, event.host, event.channel, event.eventId, event.user, event.sourceIp, event.process, event.commandLine]
}

function recordLimit(count: number) {
  if (count > MAX_LOG_RECORDS) throw new Error(`Import exceeds the ${MAX_LOG_RECORDS.toLocaleString('en-GB')}-record limit, including duplicates and unsupported records.`)
}

/** JSON.parse accepts duplicate object keys. Reject ambiguity before using the parsed value. */
function unambiguousJson(text: string): unknown {
  const stack: ({ object: true; keys: Set<string>; expectingKey: boolean } | { object: false })[] = []
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '{') stack.push({ object: true, keys: new Set(), expectingKey: true })
    else if (char === '[') stack.push({ object: false })
    else if (char === '}' || char === ']') stack.pop()
    else if (char === ',') {
      const current = stack.at(-1)
      if (current?.object) current.expectingKey = true
    } else if (char === '"') {
      const start = index
      index += 1
      while (index < text.length && text[index] !== '"') {
        if (text[index] === '\\') index += 1
        index += 1
      }
      const current = stack.at(-1)
      if (current?.object && current.expectingKey) {
        const key: string = JSON.parse(text.slice(start, index + 1))
        if (current.keys.has(key)) throw new Error('Duplicate JSON object fields are not allowed.')
        current.keys.add(key)
        current.expectingKey = false
      }
    }
    if (stack.length > 64) throw new Error('JSON nesting exceeds the 64-level import limit.')
  }
  return JSON.parse(text) as unknown
}

function jsonRows(text: string, ndjson: boolean): unknown[] {
  if (!ndjson) {
    let parsed: unknown
    try { parsed = unambiguousJson(text) } catch { throw new Error('Invalid or ambiguous JSON. Use an array of unique-field event objects or one object per NDJSON line.') }
    if (!Array.isArray(parsed)) throw new Error('JSON imports must contain an array of event objects.')
    recordLimit(parsed.length)
    return parsed
  }
  const rows: unknown[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try { rows.push(unambiguousJson(line)) } catch { throw new Error(`Invalid or ambiguous NDJSON on non-empty record ${rows.length + 1}.`) }
    recordLimit(rows.length)
  }
  return rows
}

function csvRows(text: string): unknown[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let closedQuote = false
  function endField() { row.push(field); field = ''; closedQuote = false }
  function endRow() {
    endField()
    if (row.length > 1 || row[0] !== '') rows.push(row)
    row = []
    recordLimit(Math.max(0, rows.length - 1))
  }
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1 }
        else { quoted = false; closedQuote = true }
      } else field += char
      continue
    }
    if (char === ',') { endField(); continue }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      endRow()
      continue
    }
    if (closedQuote) {
      if (char !== ' ' && char !== '\t') throw new Error('Invalid CSV: unexpected text after a closing quote.')
      continue
    }
    if (char === '"') {
      if (field !== '') throw new Error('Invalid CSV: quotes must start at the beginning of a field.')
      quoted = true
    } else field += char
  }
  if (quoted) throw new Error('Invalid CSV: an opening quote has no closing quote.')
  if (field !== '' || row.length || closedQuote) endRow()
  const header = rows.shift()
  if (!header) throw new Error('CSV requires a header and at least one event.')
  const names = header.map((name) => name.trim().toLowerCase())
  if (names.some((name) => !name) || new Set(names).size !== names.length) throw new Error('CSV headers must be non-empty and unique, ignoring case.')
  const aliases: Record<string, string> = {
    timestamp: 'timestamp', timecreated: 'timestamp', host: 'host', computer: 'host', channel: 'channel', eventid: 'eventId',
    user: 'user', targetusername: 'user', sourceip: 'sourceIp', ipaddress: 'sourceIp', process: 'process', image: 'process', commandline: 'commandLine',
  }
  const keys = names.map((name) => aliases[name])
  const recognized = keys.filter(Boolean)
  if (new Set(recognized).size !== recognized.length) throw new Error('CSV includes more than one header for the same event field.')
  for (const required of ['timestamp', 'host', 'channel', 'eventId']) {
    if (!keys.includes(required)) throw new Error(`CSV is missing the ${required} header.`)
  }
  return rows.map((values, index) => {
    if (values.length !== header.length) throw new Error(`CSV record ${index + 1} has a different number of fields from its header.`)
    const result: Record<string, unknown> = {}
    keys.forEach((key, column) => { if (key) result[key] = values[column] })
    if (typeof result.eventId === 'string' && /^\d+$/.test(result.eventId.trim())) result.eventId = Number(result.eventId.trim())
    return result
  })
}

function xmlRows(text: string): unknown[] {
  if (/<\s*!\s*(?:DOCTYPE|ENTITY)\b/i.test(text)) throw new Error('XML DTD and entity declarations are not allowed. Export plain Windows event XML.')
  if (typeof DOMParser === 'undefined') throw new Error('XML import requires a browser. Use JSON, NDJSON or CSV in this environment.')
  const document = new DOMParser().parseFromString(text, 'application/xml')
  if (document.getElementsByTagName('parsererror').length) throw new Error('Invalid XML. Export a complete Windows Event or Events document.')
  const root = document.documentElement
  if (root.localName !== 'Event' && root.localName !== 'Events') throw new Error('XML requires a Windows Event or Events root.')
  const elements = root.localName === 'Event' ? [root] : Array.from(root.children)
  recordLimit(elements.length)
  if (elements.some((element) => element.localName !== 'Event')) throw new Error('XML Events must contain only Event elements.')
  function one(parent: Element, name: string, required = true): Element | undefined {
    const matches = Array.from(parent.children).filter((child) => child.localName === name)
    if (matches.length > 1 || (required && matches.length !== 1)) throw new Error(`XML event requires exactly one ${name} element.`)
    return matches[0]
  }
  function simple(element: Element | undefined): string {
    if (!element) return ''
    if (element.children.length) throw new Error('XML event field contains unsupported nested elements.')
    return element.textContent ?? ''
  }
  return elements.map((element) => {
    const system = one(element, 'System')!
    const data = one(element, 'EventData', false)
    const values = new Map<string, string>()
    for (const child of data ? Array.from(data.children) : []) {
      const name = child.getAttribute('Name')
      if (child.localName !== 'Data' || !name || values.has(name)) throw new Error('XML EventData requires unique named Data fields.')
      values.set(name, simple(child))
    }
    let user = values.get('TargetUserName') ?? values.get('User') ?? ''
    const domain = values.get('TargetDomainName')
    if (user && user !== '-' && domain && domain !== '-' && !user.includes('\\')) user = `${domain}\\${user}`
    const eventId = simple(one(system, 'EventID')).trim()
    return {
      timestamp: one(system, 'TimeCreated')!.getAttribute('SystemTime'),
      host: simple(one(system, 'Computer')),
      channel: simple(one(system, 'Channel')).trim(),
      eventId: /^\d+$/.test(eventId) ? Number(eventId) : eventId,
      user,
      sourceIp: values.get('IpAddress') ?? values.get('SourceIp') ?? '',
      process: values.get('Image') ?? values.get('ProcessName') ?? '',
      commandLine: values.get('CommandLine') ?? '',
    }
  })
}

/** Rejects a malformed file atomically; unsupported valid event types are counted and skipped. */
export function parseLogs(text: string, filename: string): LogDataset {
  if (encoder.encode(text).byteLength > MAX_LOG_BYTES) throw new Error('Import exceeds the 5 MiB file limit.')
  const clean = text.replace(/^\uFEFF/, '').trim()
  if (!clean) throw new Error('The file is empty. Import at least one event.')
  const extension = filename.toLowerCase().split('.').pop()
  let rows: unknown[]
  if (extension === 'xml' || clean.startsWith('<')) rows = xmlRows(clean)
  else if (extension === 'csv') rows = csvRows(clean)
  else if (extension === 'ndjson' || extension === 'jsonl') rows = jsonRows(clean, true)
  else if (clean.startsWith('[') || extension === 'json') rows = jsonRows(clean, false)
  else if (clean.startsWith('{')) rows = jsonRows(clean, true)
  else rows = csvRows(clean)
  recordLimit(rows.length)
  if (!rows.length) throw new Error('The file contains no event records.')
  const unique = new Map<string, LogEvent>()
  const ids = new Map<string, string>()
  let duplicateCount = 0
  let unsupportedCount = 0
  let missingIdentity = 0
  let missingProcess = 0
  for (const [index, row] of rows.entries()) {
    try {
      if (!isRecord(row)) throw new Error('each event must be an object.')
      const time = timestamp(row.timestamp)
      if (typeof row.eventId !== 'number' || !Number.isSafeInteger(row.eventId) || row.eventId <= 0) throw new Error('eventId must be a positive safe integer, not text.')
      if (typeof row.channel !== 'string' || !row.channel.trim()) throw new Error('channel must be non-empty text.')
      if (/[\uD800-\uDFFF]/u.test(row.channel)) throw new Error('channel contains invalid Unicode.')
      if (encoder.encode(row.channel.trim()).byteLength > 128 || /\p{Cc}/u.test(row.channel.trim())) throw new Error('channel exceeds its 128-byte limit or contains unsupported control characters.')
      const host = textField(row.host, 'host')
      if (!host) throw new Error('host is required and must be non-empty text.')
      const user = textField(row.user, 'user')
      const sourceIp = textField(row.sourceIp, 'sourceIp')
      const process = textField(row.process, 'process')
      const commandLine = textField(row.commandLine, 'commandLine')
      const channel = row.channel.trim() === SYSMON_CHANNEL ? 'Sysmon' : row.channel.trim()
      if (!((channel === 'Security' && (row.eventId === 4624 || row.eventId === 4625)) || (channel === 'Sysmon' && (row.eventId === 1 || row.eventId === 3)))) {
        unsupportedCount += 1
        continue
      }
      const event: Omit<LogEvent, 'id'> = { timestamp: time, host, channel, eventId: row.eventId, user, sourceIp, process, commandLine }
      const key = JSON.stringify(eventParts(event))
      if (unique.has(key)) { duplicateCount += 1; continue }
      const id = stableId('evt', eventParts(event))
      if (ids.has(id) && ids.get(id) !== key) throw new Error('event identifier collision; split the file into smaller imports.')
      ids.set(id, key)
      unique.set(key, { id, ...event })
      if (channel === 'Security' && (!user || !sourceIp)) missingIdentity += 1
      if (channel === 'Sysmon' && row.eventId === 1 && (!process || !commandLine)) missingProcess += 1
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'invalid event.'
      throw new Error(`Record ${index + 1}: ${detail} No records were imported.`)
    }
  }
  const warnings: string[] = []
  if (unsupportedCount) warnings.push(`${unsupportedCount} unsupported record(s) skipped. Supported: Security 4624/4625, Sysmon 1, and Sysmon 3 as context only.`)
  if (duplicateCount) warnings.push(`${duplicateCount} duplicate record(s) removed using all normalized event fields; imported IDs are not trusted.`)
  if (missingIdentity) warnings.push(`${missingIdentity} authentication event(s) lack a user or source IP and are excluded from R001/R002 correlation.`)
  if (missingProcess) warnings.push(`${missingProcess} process event(s) lack an executable or command line and cannot match R003.`)
  warnings.push('Timestamps are normalized to UTC milliseconds; sub-millisecond precision is truncated. These limited rules cannot establish that an attack occurred.')
  const events = [...unique.values()].sort(eventOrder)
  return { events, warnings, duplicateCount, unsupportedCount }
}

function textOrder(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0 }
function eventOrder(a: LogEvent, b: LogEvent): number {
  return Date.parse(a.timestamp) - Date.parse(b.timestamp) || textOrder(a.id, b.id)
}

function alert(ruleId: 'R001' | 'R002' | 'R003', proof: LogEvent[]): DetectionAlert {
  const rule = DETECTION_RULES.find((candidate) => candidate.id === ruleId)!
  const first = proof[0]
  const last = proof[proof.length - 1]
  const evidenceIds = proof.map((event) => event.id)
  const summary = ruleId === 'R001'
    ? 'Five same-identity failed logons fall within five minutes. This is the first qualifying proof in a contiguous failure burst; later failures in that burst are not additional alerts.'
    : ruleId === 'R002'
      ? 'A same-identity successful logon follows a qualifying five-failure window within ten minutes. This sequence needs review; it does not establish account compromise.'
      : 'A process-creation record identifies PowerShell with an encoded-command flag. Encoded administration can be legitimate; the command was not decoded or executed.'
  const nextSteps = ruleId === 'R003'
    ? ['Check the executable path, parent process and authorized administrative activity in the original logs.', 'Review the command in a safe, approved investigation environment; do not run it.', 'Confirm whether additional authorized telemetry supports escalation.']
    : ['Review the original events, logon type and authentication context.', 'Confirm expected account activity and whether retries or shared addresses explain the sequence.', 'Use authorized follow-up evidence before escalating or taking any containment action.']
  const falsePositives = ruleId === 'R003'
    ? ['Legitimate administration, deployment scripts and automation can use encoded commands.']
    : ['Mistyped or expired passwords, normal retries and a legitimate user subsequently signing in.', 'Shared source addresses and incomplete identity fields can mislead correlation.']
  return { id: stableId('alert', [ruleId, ...evidenceIds]), ruleId, title: rule.title, severity: ruleId === 'R002' ? 'high' : 'medium', summary, evidenceIds, firstSeen: first.timestamp, lastSeen: last.timestamp, nextSteps, falsePositives }
}

function encodedCommandArgument(commandLine: string): boolean {
  const tokens: string[] = []
  let token = ''
  let quote = ''
  for (let index = 0; index < commandLine.length; index += 1) {
    const char = commandLine[index]
    if (quote) {
      if (char === '\\' && commandLine[index + 1] === quote) { token += quote; index += 1 }
      else if (char === quote) quote = ''
      else token += char
    } else if (char === '"' || char === "'") quote = char
    else if (/\s/.test(char)) { if (token) tokens.push(token); token = '' }
    else token += char
  }
  if (quote) return false
  if (token) tokens.push(token)
  for (const argument of tokens) {
    if (/^-(?:enc|encodedcommand)$/i.test(argument)) return true
    // Following text belongs to a script/command rather than PowerShell launch switches.
    if (/^-(?:command|c|file|f)$/i.test(argument)) return false
  }
  return false
}

/** Deterministic candidate rules over normalized events; never executes commands or containment. */
export function analyzeLogs(events: LogEvent[]): DetectionAlert[] {
  recordLimit(events.length)
  const sorted = [...events].sort(eventOrder)
  const alerts: DetectionAlert[] = []
  const groups = new Map<string, { failures: LogEvent[]; successes: LogEvent[] }>()
  for (const event of sorted) {
    if (event.channel === 'Security' && (event.eventId === 4624 || event.eventId === 4625) && event.host && event.user && event.sourceIp) {
      const key = JSON.stringify([event.host, event.user, event.sourceIp])
      const group = groups.get(key) ?? { failures: [], successes: [] }
      if (event.eventId === 4625) group.failures.push(event)
      else group.successes.push(event)
      groups.set(key, group)
    }
    if (event.channel === 'Sysmon' && event.eventId === 1) {
      const executable = event.process.split(/[\\/]/).pop() ?? ''
      if (/^(?:powershell|pwsh)(?:\.exe)?$/i.test(executable) && encodedCommandArgument(event.commandLine)) alerts.push(alert('R003', [event]))
    }
  }
  for (const { failures, successes } of groups.values()) {
    let burstAlerted = false
    for (let index = 0; index < failures.length; index += 1) {
      const current = Date.parse(failures[index].timestamp)
      if (index === 0 || current - Date.parse(failures[index - 1].timestamp) > WINDOW_MS) burstAlerted = false
      if (!burstAlerted && index >= 4 && current - Date.parse(failures[index - 4].timestamp) <= WINDOW_MS) {
        alerts.push(alert('R001', failures.slice(index - 4, index + 1)))
        burstAlerted = true
      }
    }
    // For each success, use the latest eligible five-failure window, not a future event.
    let cursor = 0
    let qualifyingEnd = -1
    for (const success of successes) {
      const time = Date.parse(success.timestamp)
      while (cursor < failures.length && Date.parse(failures[cursor].timestamp) < time) {
        if (cursor >= 4 && Date.parse(failures[cursor].timestamp) - Date.parse(failures[cursor - 4].timestamp) <= WINDOW_MS) qualifyingEnd = cursor
        cursor += 1
      }
      if (qualifyingEnd >= 4 && time - Date.parse(failures[qualifyingEnd].timestamp) <= SUCCESS_WINDOW_MS) {
        alerts.push(alert('R002', [...failures.slice(qualifyingEnd - 4, qualifyingEnd + 1), success]))
      }
    }
  }
  return alerts.sort((a, b) => Date.parse(a.firstSeen) - Date.parse(b.firstSeen) || textOrder(a.ruleId, b.ruleId) || textOrder(a.id, b.id))
}
