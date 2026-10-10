import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzeLogs, parseLogs, DETECTION_RULES, MAX_LOG_BYTES, MAX_LOG_RECORDS } from '../../app/lib/log-analysis.ts'
import { suspiciousFixture, benignFixture } from '../../app/lib/log-fixtures.ts'

const BASE = Date.parse('2026-10-09T09:00:00.000Z')
const iso = (milliseconds) => new Date(BASE + milliseconds).toISOString()
const auth = (milliseconds, eventId = 4625, overrides = {}) => ({
  timestamp: iso(milliseconds), host: 'SYNTHETIC-LAB-01', channel: 'Security', eventId,
  user: 'synthetic-user', sourceIp: '192.0.2.42', process: '', commandLine: '', ...overrides,
})
const process = (overrides = {}) => ({
  timestamp: iso(0), host: 'SYNTHETIC-LAB-01', channel: 'Sysmon', eventId: 1,
  user: 'synthetic-user', sourceIp: '', process: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', commandLine: 'pwsh.exe -enc ABC', ...overrides,
})
const dataset = (rows) => parseLogs(JSON.stringify(rows), 'logs.json')
const alerts = (rows, rule) => analyzeLogs(dataset(rows).events).filter((alert) => !rule || alert.ruleId === rule)
const failures = (times = [0, 15_000, 30_000, 45_000, 60_000], overrides = {}) => times.map((time) => auth(time, 4625, overrides))
const csv = (rows, headers = ['timestamp', 'host', 'channel', 'eventId', 'user', 'sourceIp', 'process', 'commandLine']) => [
  headers.join(','), ...rows.map((row) => headers.map((field) => `"${String(row[field] ?? '').replaceAll('"', '""')}"`).join(',')),
].join('\r\n')

test('synthetic suspicious fixture has ten events and independently fixed three candidate proofs', () => {
  const parsed = dataset(suspiciousFixture)
  assert.equal(parsed.events.length, 10)
  assert.deepEqual(analyzeLogs(parsed.events).map((alert) => [alert.ruleId, alert.severity, alert.id, alert.evidenceIds.length]), [
    ['R001', 'medium', 'alert-13529386e20896e8', 5],
    ['R002', 'high', 'alert-e87fa79ce8fa009a', 6],
    ['R003', 'medium', 'alert-162b3b8b0e1bf189', 1],
  ])
  assert.equal(parsed.events[0].id, 'evt-aaee2237b3797a31')
  assert.equal(parsed.duplicateCount, 0)
  assert.equal(parsed.unsupportedCount, 0)
  assert.ok(parsed.warnings.some((warning) => /cannot establish that an attack occurred/.test(warning)))
  for (const alert of analyzeLogs(parsed.events)) {
    assert.ok(alert.nextSteps.length > 0)
    assert.ok(alert.falsePositives.length > 0)
    assert.ok(alert.evidenceIds.every((id) => parsed.events.some((event) => event.id === id)))
    assert.ok(alert.firstSeen <= alert.lastSeen)
  }
})

test('benign fixture has five supported events and zero candidate alerts', () => {
  assert.equal(dataset(benignFixture).events.length, 5)
  assert.deepEqual(alerts(benignFixture), [])
})

test('rules state exact time windows, bounded proofs, benign explanations and missing identity limits', () => {
  assert.deepEqual(DETECTION_RULES.map((rule) => rule.id), ['R001', 'R002', 'R003'])
  assert.ok(DETECTION_RULES[0].description.includes('inclusive five-minute'))
  assert.ok(DETECTION_RULES[0].limitations.some((text) => text.includes('contiguous burst')))
  assert.ok(DETECTION_RULES[1].limitations.some((text) => text.includes('success timestamp')))
  assert.ok(DETECTION_RULES[2].limitations.some((text) => text.includes('does not decode or execute')))
})

test('JSON, NDJSON, CSV and BOM variants normalize to identical safe events', () => {
  const expected = dataset(suspiciousFixture)
  for (const [text, filename] of [
    ['\uFEFF' + JSON.stringify(suspiciousFixture), 'UPPER.JSON'],
    [suspiciousFixture.map((row) => JSON.stringify(row)).join('\n\n'), 'logs.ndjson'],
    [suspiciousFixture.map((row) => JSON.stringify(row)).join('\r\n'), 'logs.jsonl'],
    [csv(suspiciousFixture), 'logs.csv'],
    [csv(suspiciousFixture), 'unknown.txt'],
  ]) assert.deepEqual(parseLogs(text, filename), expected)
  assert.deepEqual(parseLogs(JSON.stringify(suspiciousFixture[0]), 'one.ndjson').events, expected.events.slice(0, 1))
})

test('events are chronologically sorted and ordering/unknown properties/imported IDs cannot change identity', () => {
  const before = structuredClone(suspiciousFixture)
  const one = dataset(before)
  const two = dataset(before.toReversed().map((event, index) => ({ id: `untrusted-${index}`, ignored: '<script>alert(1)</script>', ...event })))
  assert.deepEqual(two, one)
  assert.deepEqual(before, suspiciousFixture)
  const frozen = Object.freeze(one.events.map((event) => Object.freeze({ ...event })))
  assert.deepEqual(analyzeLogs(frozen), analyzeLogs(two.events))
})

test('canonical dedup ignores imported ID and normalizes timezone, whitespace and Sysmon channel alias', () => {
  const first = process()
  const equivalent = { ...first, timestamp: '2026-10-09T10:00:00.000+01:00', host: ` ${first.host} `, channel: 'Microsoft-Windows-Sysmon/Operational', id: 'other-id' }
  const parsed = dataset([first, equivalent])
  assert.equal(parsed.events.length, 1)
  assert.equal(parsed.duplicateCount, 1)
  assert.ok(parsed.warnings.some((warning) => /duplicate/.test(warning)))
  assert.equal(parsed.events[0].channel, 'Sysmon')
  assert.equal(parsed.events[0].timestamp, iso(0))
  assert.equal(dataset([first, { ...first, commandLine: 'pwsh.exe -enc OTHER' }]).events.length, 2)
})

test('UTC offset and Windows fractional precision normalize strictly to UTC milliseconds', () => {
  assert.equal(dataset([auth(0, 4625, { timestamp: '2026-10-09T03:30:00.123456789-05:30' })]).events[0].timestamp, '2026-10-09T09:00:00.123Z')
  assert.equal(dataset([auth(0, 4625, { timestamp: '2026-10-09T09:00:00Z' })]).events[0].timestamp, iso(0))
  assert.equal(dataset([auth(0, 4625, { timestamp: '2024-02-29T09:00:00.1Z' })]).events[0].timestamp, '2024-02-29T09:00:00.100Z')
  for (const invalid of ['2026-02-29T09:00:00Z', '2026-02-30T09:00:00Z', '2026-13-01T09:00:00Z', '2026-10-09', '2026-10-09T09:00:00', '2026-10-09T24:00:00Z', '2026-10-09T09:60:00Z', '2026-10-09T09:00:60Z', '2026-10-09T09:00:00+24:00', '2026-10-09T09:00:00+01:60', '2026-10-09T09:00:00.1234567890Z', '0000-10-09T09:00:00Z', '0001-01-01T00:00:00+01:00', '9999-12-31T23:30:00-01:00', 1791536400000]) {
    assert.throws(() => dataset([auth(0, 4625, { timestamp: invalid })]), /timestamp/)
  }
})

test('duplicate JSON keys including escaped names and nested ignored objects reject atomically', () => {
  const valid = JSON.stringify(auth(0))
  for (const input of [valid.replace('"eventId":4625', '"eventId":1,"eventId":4625'), valid.replace('"host":', '"ho\\u0073t":"other","host":'), valid.replace(/}$/, ',"ignored":{"a":1,"a":2}}')]) {
    assert.throws(() => parseLogs(`[${input}]`, 'logs.json'), /ambiguous JSON/)
    assert.throws(() => parseLogs(`${valid}\n${input}`, 'logs.ndjson'), /ambiguous NDJSON.*record 2/)
  }
  // A comma or object-like string is a value, not another field; distinct nesting scopes are legal.
  assert.equal(dataset([{ ...auth(0), commandLine: 'literal ", host: another" { "same": 1, "same": 2 }', ignored: { host: { host: 1 }, array: [{ a: 1 }, { a: 2 }] } }]).events.length, 1)
  assert.throws(() => parseLogs('['.repeat(65) + '0' + ']'.repeat(65), 'logs.json'), /ambiguous JSON/)
  assert.throws(() => parseLogs('[{"host":"x","host":]', 'logs.json'), /JSON/)
})

test('supported malformed records fail atomically with a safe record-index error', () => {
  for (const bad of [null, [], 1, 'event', { ...auth(0), eventId: '4625' }, { ...auth(0), eventId: 1.2 }, { ...auth(0), eventId: 0 }, { ...auth(0), eventId: -1 }, { ...auth(0), eventId: Number.MAX_SAFE_INTEGER + 1 }, { ...auth(0), channel: null }, { ...auth(0), channel: ' ' }, { ...auth(0), host: '' }, { ...auth(0), host: null }, { ...auth(0), user: 123 }, { ...auth(0), sourceIp: {} }]) {
    assert.throws(() => dataset([auth(0), bad]), /Record 2: .*No records were imported\./)
  }
  const secret = 'DO-NOT-INCLUDE-THIS-SECRET'
  assert.throws(() => dataset([auth(0), { ...auth(0), timestamp: secret }]), (error) => !error.message.includes(secret))
})

test('empty, non-array JSON, malformed JSON and NDJSON rows reject rather than partially import', () => {
  for (const text of ['', '   ', '[]', '\uFEFF\n', '{}', '[{"timestamp":', 'null']) assert.throws(() => parseLogs(text, 'logs.json'))
  assert.throws(() => parseLogs(`${JSON.stringify(auth(0))}\n{broken`, 'logs.ndjson'), /record 2/)
  assert.throws(() => parseLogs(`${JSON.stringify(auth(0))}\n[]`, 'logs.ndjson'), /Record 2/)
})

test('unsupported valid event/channel combinations are explicitly counted and skipped', () => {
  const parsed = dataset([auth(0), auth(1, 4672), auth(2, 1), process({ eventId: 4 }), process({ channel: 'Application' }), auth(3, 4625, { channel: 'Sysmon' })])
  assert.equal(parsed.events.length, 1)
  assert.equal(parsed.unsupportedCount, 5)
  assert.ok(parsed.warnings.some((warning) => /5 unsupported/.test(warning)))
  assert.equal(dataset([auth(0, 4672)]).events.length, 0)
  assert.throws(() => dataset([auth(0, 4672, { timestamp: 'invalid' })]), /timestamp/)
})

test('Sysmon 3 is context only, not encoded-command or authentication detection', () => {
  const parsed = dataset([process({ eventId: 3, sourceIp: '192.0.2.42' }), process({ eventId: 3, process: '', commandLine: '', timestamp: iso(1) })])
  assert.equal(parsed.events.length, 2)
  assert.equal(parsed.unsupportedCount, 0)
  assert.deepEqual(analyzeLogs(parsed.events), [])
  assert.equal(parsed.warnings.some((warning) => /cannot match R003/.test(warning)), false)
})

test('channel text is bounded and validated even when the channel is unsupported', () => {
  for (const channel of ['x'.repeat(129), 'Security\u0000', 'unsupported\nchannel']) assert.throws(() => dataset([auth(0, 4625, { channel })]), /channel/)
  assert.equal(dataset([auth(0, 4625, { channel: 'x'.repeat(128) })]).unsupportedCount, 1)
})

test('numeric timestamp sorting is chronological across UTC year boundaries', () => {
  const parsed = dataset([auth(0, 4625, { timestamp: '2026-12-31T23:30:00-01:00' }), auth(0, 4625, { timestamp: '2026-12-31T23:30:00Z' })])
  assert.equal(parsed.events[0].timestamp, '2026-12-31T23:30:00.000Z')
  assert.equal(parsed.events[1].timestamp, '2027-01-01T00:30:00.000Z')
})

test('missing auth identity is retained as evidence but excluded from correlation with warnings', () => {
  for (const value of ['', ' ', '-', null, undefined]) {
    for (const field of ['user', 'sourceIp']) {
      const parsed = dataset([...failures(undefined, { [field]: value }), auth(70_000, 4624, { [field]: value })])
      assert.equal(parsed.events.length, 6)
      assert.equal(parsed.events[0][field], '')
      assert.deepEqual(analyzeLogs(parsed.events), [])
      assert.ok(parsed.warnings.some((warning) => /6 authentication.*excluded/.test(warning)))
    }
  }
  const parsed = dataset([process({ process: '', commandLine: null })])
  assert.ok(parsed.warnings.some((warning) => /cannot match R003/.test(warning)))
})

test('harmless markup and command text remain literal text; unrecognized properties are discarded', () => {
  const payload = '<img src=x onerror="alert(1)"> & =HYPERLINK("https://example.invalid")\nnext line'
  const parsed = dataset([process({ commandLine: payload, ignored: { executable: 'do-not-run' } })])
  assert.equal(parsed.events[0].commandLine, payload)
  assert.equal(Object.hasOwn(parsed.events[0], 'ignored'), false)
  assert.deepEqual(analyzeLogs(parsed.events), [])
  for (const field of ['host', 'user', 'sourceIp', 'process', 'commandLine']) assert.throws(() => dataset([{ ...auth(0), [field]: 'bad\u0000text' }]), /control characters/)
})

test('invalid lone Unicode surrogates reject rather than being silently replaced during UTF8 hashing', () => {
  for (const field of ['host', 'user', 'sourceIp', 'process', 'commandLine', 'channel']) {
    for (const value of ['\ud800', 'x\udfff', '\ud800\ud800']) assert.throws(() => dataset([auth(0, 4625, { [field]: value })]), /invalid Unicode/)
  }
  const valid = dataset([auth(0, 4625, { host: 'SYNTHETIC-💥', user: 'synthetic-𐐀' })])
  assert.equal(valid.events[0].host, 'SYNTHETIC-💥')
  assert.equal(valid.events[0].user, 'synthetic-𐐀')
  const literal = JSON.stringify({ ...auth(0), commandLine: 'line\u2028separator\u2029text' })
  assert.equal(parseLogs(literal, 'logs.ndjson').events[0].commandLine, 'line\u2028separator\u2029text')
})

test('text limits count UTF8 bytes and avoid truncating evidence silently', () => {
  assert.equal(dataset([auth(0, 4625, { host: 'é'.repeat(128) })]).events[0].host, 'é'.repeat(128))
  for (const [field, length] of [['host', 256], ['user', 256], ['sourceIp', 128], ['process', 1024], ['commandLine', 8192]]) {
    assert.equal(dataset([auth(0, 4625, { [field]: 'x'.repeat(length) })]).events[0][field].length, length)
    assert.throws(() => dataset([auth(0, 4625, { [field]: 'x'.repeat(length + 1) })]), /text limit/)
  }
})

test('5 MiB byte and 10,000 raw-record bounds include unsupported records and duplicates', () => {
  const single = JSON.stringify([auth(0)])
  assert.equal(parseLogs(single + ' '.repeat(MAX_LOG_BYTES - single.length), 'logs.json').events.length, 1)
  assert.throws(() => parseLogs(' '.repeat(MAX_LOG_BYTES + 1), 'logs.json'), /5 MiB/)
  assert.throws(() => parseLogs('💥'.repeat(Math.ceil(MAX_LOG_BYTES / 4)), 'logs.json'), /JSON|5 MiB/)
  const repeated = Array.from({ length: MAX_LOG_RECORDS }, () => auth(0))
  assert.equal(dataset(repeated).duplicateCount, MAX_LOG_RECORDS - 1)
  assert.throws(() => dataset([...repeated, auth(0, 4672)]), /10,000-record/)
  assert.throws(() => parseLogs([...repeated, auth(0)].map((row) => JSON.stringify(row)).join('\n'), 'logs.ndjson'), /10,000-record/)
  assert.throws(() => parseLogs(csv([...repeated, auth(0)]), 'logs.csv'), /10,000-record/)
  assert.throws(() => analyzeLogs(Array(MAX_LOG_RECORDS + 1)), /10,000-record/)
})

test('CSV quoting preserves commas, newlines and doubled quotes with strict row shape', () => {
  const row = process({ commandLine: 'pwsh.exe -Command "Write-Output \'hello, world\'"\r\nnext line' })
  assert.deepEqual(parseLogs(csv([row]), 'logs.csv'), dataset([row]))
  const aliases = 'TimeCreated,Computer,Channel,EventID,TargetUserName,IpAddress,Image,CommandLine\n2026-10-09T09:00:00Z,SYNTHETIC-LAB-01,Security,4625,synthetic-user,192.0.2.42,,\n'
  assert.deepEqual(parseLogs(aliases, 'logs.csv').events, dataset([auth(0)]).events)
  for (const invalid of ['timestamp,host,channel,eventId\n"unclosed', 'timestamp,host,channel,eventId\n"x"unexpected,h,Security,4625', 'timestamp,host,channel,eventId\na"b,h,Security,4625', 'timestamp,host,channel,eventId\nx,h,Security', 'timestamp,HOST,host,channel,eventId\nx,h,h,Security,4625', 'timestamp,host,Computer,channel,eventId\nx,h,h,Security,4625', 'timestamp,host,,eventId\nx,h,Security,4625', 'host,channel,eventId\nh,Security,4625', 'timestamp,host,channel,eventId\n2026-10-09T09:00:00Z,h,Security,4.625e3']) assert.throws(() => parseLogs(invalid, 'logs.csv'))
})

test('XML is browser-only, with DTD/entity declarations rejected before any parser can run', () => {
  assert.equal(typeof globalThis.DOMParser, 'undefined')
  assert.throws(() => parseLogs('<Events/>', 'logs.xml'), /requires a browser/)
  for (const input of ['<!DOCTYPE Events SYSTEM "https://example.invalid"><Events/>', '<!ENTITY x "secret"><Events/>', '<!dOcTyPe Events [<!ENTITY x SYSTEM "file:///private">]><Events/>']) {
    assert.throws(() => parseLogs(input, 'logs.xml'), /DTD and entity declarations/)
  }
})

test('R001 requires five failures and includes exact five-minute boundary but not one millisecond beyond', () => {
  assert.equal(alerts(failures([0, 75_000, 150_000, 225_000]), 'R001').length, 0)
  assert.equal(alerts(failures([0, 75_000, 150_000, 225_000, 300_000]), 'R001').length, 1)
  assert.equal(alerts(failures([0, 75_000, 150_000, 225_000, 300_001]), 'R001').length, 0)
})

test('R001 sliding windows can qualify after older out-of-window failures', () => {
  const rows = failures([0, 290_000, 300_000, 310_000, 320_000, 330_000])
  const parsed = dataset(rows)
  const found = analyzeLogs(parsed.events).filter((alert) => alert.ruleId === 'R001')
  assert.equal(found.length, 1)
  assert.deepEqual(found[0].evidenceIds, parsed.events.slice(1).map((event) => event.id))
})

test('R001 alert grouping stays contiguous at a five-minute gap and resets only beyond it', () => {
  const first = [0, 10_000, 20_000, 30_000, 40_000]
  const continuation = [340_000, 350_000, 360_000, 370_000, 380_000]
  assert.equal(alerts(failures([...first, ...continuation]), 'R001').length, 1)
  assert.equal(alerts(failures([...first, ...continuation.map((time) => time + 1)]), 'R001').length, 2)
  assert.equal(alerts(failures(Array.from({ length: 100 }, (_, index) => index * 10_000)), 'R001').length, 1)
})

test('R001/R002 never combine unrelated hosts, users, source IPs or channels', () => {
  for (const field of ['host', 'user', 'sourceIp']) {
    assert.equal(alerts([...failures([0, 1000, 2000, 3000]), auth(4000, 4625, { [field]: 'other' })], 'R001').length, 0)
    assert.equal(alerts([...failures(), auth(70_000, 4624, { [field]: 'other' })], 'R002').length, 0)
  }
  const parsed = dataset([...failures([0, 1000, 2000, 3000]), auth(4000, 4625, { channel: 'Sysmon' })])
  assert.equal(parsed.unsupportedCount, 1)
  assert.equal(analyzeLogs(parsed.events).length, 0)
})

test('R002 requires a preceding qualifying window; exact success/final-failure ordering is conservative', () => {
  assert.equal(alerts([...failures(), auth(59_999, 4624)], 'R002').length, 0)
  assert.equal(alerts([...failures(), auth(60_000, 4624)], 'R002').length, 0)
  assert.equal(alerts([...failures(), auth(60_001, 4624)], 'R002').length, 1)
  assert.equal(alerts([...failures([0, 1000, 2000, 3000]), auth(4000, 4624)], 'R002').length, 0)
  assert.equal(alerts([...failures([0, 75_000, 150_000, 225_000, 300_001]), auth(300_002, 4624)], 'R002').length, 0)
})

test('R002 includes ten minutes after final qualifying failure and rejects one millisecond beyond', () => {
  assert.equal(alerts([...failures(), auth(660_000, 4624)], 'R002').length, 1)
  assert.equal(alerts([...failures(), auth(660_001, 4624)], 'R002').length, 0)
})

test('R002 uses latest five-event proof and creates at most one alert per distinct successful event', () => {
  const rows = [...failures([0, 10_000, 20_000, 30_000, 40_000, 50_000]), auth(60_000, 4624), auth(70_000, 4624), auth(60_000, 4624)]
  const parsed = dataset(rows)
  const found = analyzeLogs(parsed.events).filter((alert) => alert.ruleId === 'R002')
  assert.equal(found.length, 2)
  assert.equal(parsed.duplicateCount, 1)
  for (const candidate of found) {
    assert.equal(candidate.evidenceIds.length, 6)
    assert.equal(candidate.firstSeen, iso(10_000))
  }
  assert.notEqual(found[0].id, found[1].id)
})

test('R003 matches only supported PowerShell executables and exact launch-flag arguments', () => {
  for (const image of ['powershell', 'powershell.exe', '/usr/bin/pwsh', 'C:\\Windows\\POWERSHELL.EXE', 'C:\\Program Files\\PowerShell\\7\\pwsh.exe']) {
    for (const commandLine of ['pwsh -enc ABC', 'pwsh -EnCoDeDcOmMaNd ABC', '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" "-enc" "ABC"', "pwsh '-EncodedCommand' ABC"]) {
      assert.equal(alerts([process({ process: image, commandLine })], 'R003').length, 1)
    }
  }
  for (const commandLine of ['pwsh -e ABC', 'pwsh --enc ABC', 'pwsh -encoding ABC', 'pwsh -enc:ABC', 'pwsh -encryption ABC', 'pwsh /enc ABC', 'pwsh foo-enc ABC', 'pwsh -Command "Write-Output \'-enc\'"', 'pwsh -c Write-Output -enc', 'pwsh -File synthetic.ps1 -enc ABC', 'pwsh -f synthetic.ps1 -enc ABC', 'pwsh "-enc ABC', 'pwsh -NoProfile']) assert.equal(alerts([process({ commandLine })], 'R003').length, 0)
  for (const image of ['cmd.exe', 'powershell.exe.example', 'powershell_ise.exe', 'notpwsh', '']) assert.equal(alerts([process({ process: image })], 'R003').length, 0)
})

test('rule proofs stay bounded for large datasets and results are deterministic without input mutation', () => {
  const rows = [...failures(Array.from({ length: 5000 }, (_, index) => index * 10)), ...Array.from({ length: 100 }, (_, index) => auth(60_000 + index, 4624))]
  const parsed = dataset(rows)
  const first = analyzeLogs(parsed.events)
  assert.equal(first.length, 101)
  assert.ok(first.every((candidate) => candidate.evidenceIds.length <= 6))
  assert.deepEqual(analyzeLogs(parsed.events.toReversed()), first)
})
