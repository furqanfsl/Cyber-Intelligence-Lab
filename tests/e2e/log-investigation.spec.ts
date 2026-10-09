import { test, expect, type Download, type Page } from '@playwright/test'
import { intelligence } from './fixtures.ts'
import { navigateWorkspace } from './workspace-helpers.ts'

const privateHost = 'private-workstation.example'
const privateUser = 'private-log-owner'
const privateIp = '198.51.100.23'
const privateCommand = 'powershell.exe -EncodedCommand U0FGRS1URVNULU9OTFk= private-commandline-token'

type ImportedEvent = {
  timestamp: string
  host: string
  channel: 'Security' | 'Sysmon'
  eventId: number
  user: string
  sourceIp: string
  process: string
  commandLine: string
}

function candidateEvents(overrides: Partial<ImportedEvent> = {}): ImportedEvent[] {
  const authentication = Array.from({ length: 6 }, (_, index): ImportedEvent => ({
    timestamp: `2026-10-09T09:0${index}:00.000Z`,
    host: privateHost,
    channel: 'Security',
    eventId: index === 5 ? 4624 : 4625,
    user: privateUser,
    sourceIp: privateIp,
    process: '',
    commandLine: '',
    ...overrides,
  }))
  return [...authentication, {
    timestamp: '2026-10-09T09:06:00.000Z',
    host: privateHost,
    channel: 'Sysmon',
    eventId: 1,
    user: privateUser,
    sourceIp: '',
    process: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    commandLine: privateCommand,
    ...overrides,
  }]
}

const workspace = (page: Page) => page.locator('#investigation')
const eventRows = (page: Page) => workspace(page).locator('.investigation-event-row')
const alertRows = (page: Page) => workspace(page).locator('.investigation-alert-row')
const detail = (page: Page) => workspace(page).locator('.investigation-detail')

async function openWorkspace(page: Page) {
  await page.goto('/#investigation')
  await expect(workspace(page).getByRole('heading', { name: 'Investigate your own logs.', exact: true })).toBeVisible()
  await expect(workspace(page).getByLabel('Import log file', { exact: true })).toBeAttached()
}

async function importText(page: Page, name: string, text: string, mimeType = 'application/json') {
  await workspace(page).getByLabel('Import log file', { exact: true }).setInputFiles({
    name, mimeType, buffer: Buffer.from(text, 'utf8'),
  })
}

async function importCandidates(page: Page, overrides: Partial<ImportedEvent> = {}) {
  await importText(page, 'owned-lab.json', JSON.stringify(candidateEvents(overrides)))
  await expect(eventRows(page)).toHaveCount(7)
  await expect(alertRows(page)).toHaveCount(3)
}

async function readDownload(download: Download) {
  const stream = await download.createReadStream()
  if (!stream) throw new Error('The local report download could not be read.')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

function fieldsIn(value: unknown, key: string): unknown[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap((entry) => fieldsIn(entry, key))
  return Object.entries(value).flatMap(([name, entry]) => [
    ...(name === key ? [entry] : []), ...fieldsIn(entry, key),
  ])
}

function xmlEscape(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function windowsXml(events: ImportedEvent[]) {
  return `<Events>${events.map((event, index) => `<Event xmlns="http://schemas.microsoft.com/win/2004/08/events/event">
<System><Provider Name="${event.channel === 'Sysmon' ? 'Microsoft-Windows-Sysmon' : 'Microsoft-Windows-Security-Auditing'}"/><EventID>${event.eventId}</EventID><TimeCreated SystemTime="${event.timestamp}"/><EventRecordID>${index + 1}</EventRecordID><Channel>${event.channel === 'Sysmon' ? 'Microsoft-Windows-Sysmon/Operational' : 'Security'}</Channel><Computer>${xmlEscape(event.host)}</Computer></System>
<EventData><Data Name="TargetUserName">${xmlEscape(event.user)}</Data><Data Name="User">${xmlEscape(event.user)}</Data><Data Name="IpAddress">${event.sourceIp}</Data><Data Name="Image">${xmlEscape(event.process)}</Data><Data Name="CommandLine">${xmlEscape(event.commandLine)}</Data></EventData></Event>`).join('\n')}</Events>`
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: intelligence }))
})

test('starts empty with honest local-only scope, not automatic monitoring', async ({ page }) => {
  await openWorkspace(page)
  await expect(eventRows(page)).toHaveCount(0)
  await expect(alertRows(page)).toHaveCount(0)
  await expect(workspace(page)).toContainText(/local|browser/i)
  await expect(workspace(page)).toContainText(/candidate|not proof|not confirmation/i)
  await expect(workspace(page).getByRole('button', { name: 'Export redacted Markdown', exact: true })).toHaveCount(0)
  await expect(workspace(page).getByRole('button', { name: 'Export redacted JSON', exact: true })).toHaveCount(0)
})

test('built-in suspicious and benign samples remain explicitly synthetic and separate from public feeds', async ({ page }) => {
  await openWorkspace(page)
  await workspace(page).getByRole('button', { name: 'Load suspicious sample', exact: true }).click()
  await expect(eventRows(page)).toHaveCount(10)
  await expect(alertRows(page)).toHaveCount(3)
  await expect(workspace(page)).toContainText(/synthetic/i)
  await page.locator('.nav-links a[href="#live-intel"]').click()
  await expect(page.locator('#live-intel')).not.toContainText(privateUser)
  await page.locator('.nav-links a[href="#investigation"]').click()
  await expect(eventRows(page)).toHaveCount(10)
  await workspace(page).getByRole('button', { name: 'Load benign sample', exact: true }).click()
  await expect(alertRows(page)).toHaveCount(0)
  expect(await eventRows(page).count()).toBeGreaterThan(0)
  await expect(workspace(page)).toContainText(/synthetic/i)
  await expect(workspace(page)).toContainText('No configured rules matched')
})

test('JSON import produces three evidence-backed candidates without uploading any log content', async ({ page }) => {
  const requests: { method: string; url: string; body: string }[] = []
  page.on('request', (request) => requests.push({ method: request.method(), url: request.url(), body: request.postData() ?? '' }))
  await openWorkspace(page)
  const marker = requests.length
  await importCandidates(page)
  await expect(alertRows(page).filter({ hasText: 'Repeated failed logons' })).toHaveCount(1)
  await expect(alertRows(page).filter({ hasText: 'Successful logon after repeated failures' })).toHaveCount(1)
  await expect(alertRows(page).filter({ hasText: 'Encoded PowerShell command' })).toHaveCount(1)
  await alertRows(page).filter({ hasText: 'Successful logon after repeated failures' }).click()
  await expect(detail(page)).toContainText('Possible benign explanations')
  await expect(detail(page)).toContainText(/next step|review|check/i)
  const origin = new URL(page.url()).origin
  for (const request of requests.slice(marker)) {
    expect(['GET', 'HEAD']).toContain(request.method)
    expect(new URL(request.url).origin).toBe(origin)
    expect(request.url + request.body).not.toMatch(/private-workstation|private-log-owner|198\.51\.100\.23|private-commandline-token/)
  }
})

for (const connection of ['public API unavailable', 'browser offline'] as const) {
  test(`local samples and own-file investigation work with ${connection}`, async ({ page }) => {
    if (connection === 'public API unavailable') {
      await page.route('**/api/live-intel', (route) => route.fulfill({
        status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture public feed unavailable' }),
      }))
    }
    await openWorkspace(page)
    await navigateWorkspace(page, 'live-intel')
    if (connection === 'browser offline') {
      await page.context().setOffline(true)
      await expect(page.locator('.live-status-badge')).toHaveText('Offline')
    } else {
      await expect(page.locator('.live-status-badge')).toHaveText('Source error')
    }
    await navigateWorkspace(page, 'investigation')
    await workspace(page).getByRole('button', { name: 'Load suspicious sample', exact: true }).click()
    await expect(eventRows(page)).toHaveCount(10)
    await expect(alertRows(page)).toHaveCount(3)
    await importCandidates(page)
    await expect(eventRows(page).first()).toContainText(privateHost)
    await alertRows(page).filter({ hasText: 'Successful logon after repeated failures' }).click()
    await expect(detail(page).locator('.investigation-evidence-row')).toHaveCount(6)
    await expect(workspace(page).getByRole('alert')).toHaveCount(0)
    await workspace(page).getByRole('button', { name: 'Load benign sample', exact: true }).click()
    await expect(eventRows(page)).toHaveCount(5)
    await expect(alertRows(page)).toHaveCount(0)
  })
}

test('NDJSON imports all records rather than only the first line', async ({ page }) => {
  await openWorkspace(page)
  await importText(page, 'owned-lab.ndjson', candidateEvents().map((event) => JSON.stringify(event)).join('\n'), 'application/x-ndjson')
  await expect(eventRows(page)).toHaveCount(7)
  await expect(alertRows(page)).toHaveCount(3)
})

test('CSV preserves quoted commas and runs the actual rules', async ({ page }) => {
  await openWorkspace(page)
  const host = 'private workstation, branch.example'
  const events = candidateEvents({ host })
  const headers = Object.keys(events[0]) as (keyof ImportedEvent)[]
  const csv = [headers.join(','), ...events.map((event) => headers.map((key) => `"${String(event[key]).replaceAll('"', '""')}"`).join(','))].join('\r\n')
  await importText(page, 'quoted-owned-lab.csv', csv, 'text/csv')
  await expect(eventRows(page)).toHaveCount(7)
  await expect(alertRows(page)).toHaveCount(3)
  await expect(eventRows(page).first()).toContainText(host)
})

test('native Windows XML imports Security and Sysmon evidence using the event namespace', async ({ page }) => {
  await openWorkspace(page)
  await importText(page, 'windows-export.xml', windowsXml(candidateEvents()), 'application/xml')
  await expect(eventRows(page)).toHaveCount(7)
  await expect(alertRows(page)).toHaveCount(3)
  await expect(workspace(page)).toContainText('4625')
  await expect(workspace(page)).toContainText('Sysmon')
})

for (const [name, invalid, mimeType] of [
  ['invalid.json', '{"timestamp":', 'application/json'],
  ['invalid.ndjson', `${JSON.stringify(candidateEvents()[0])}\nnot JSON`, 'application/x-ndjson'],
  ['invalid.csv', 'timestamp,host,channel,eventId\n"unterminated', 'text/csv'],
  ['invalid.xml', '<Events><Event>', 'application/xml'],
] as const) {
  test(`${name} is rejected atomically while the previous dataset stays available`, async ({ page }) => {
    await openWorkspace(page)
    await importCandidates(page)
    const previousEvents = await eventRows(page).allTextContents()
    const previousAlerts = await alertRows(page).allTextContents()
    await importText(page, name, invalid, mimeType)
    await expect(workspace(page).getByRole('alert')).toBeVisible()
    await expect(eventRows(page)).toHaveCount(7)
    expect(await eventRows(page).allTextContents()).toEqual(previousEvents)
    expect(await alertRows(page).allTextContents()).toEqual(previousAlerts)
    await importCandidates(page)
    await expect(workspace(page).getByRole('alert')).toHaveCount(0)
  })
}

test('invalid UTF-8 bytes are rejected instead of silently changing imported identifiers', async ({ page }) => {
  await openWorkspace(page)
  await importCandidates(page)
  const previousEvents = await eventRows(page).allTextContents()
  const previousAlerts = await alertRows(page).allTextContents()
  const validJson = JSON.stringify(candidateEvents())
  const identifierStart = validJson.indexOf(privateHost)
  const before = validJson.slice(0, identifierStart)
  const after = validJson.slice(identifierStart + privateHost.length)
  await workspace(page).getByLabel('Import log file', { exact: true }).setInputFiles({
    name: 'invalid-encoding.json', mimeType: 'application/json',
    buffer: Buffer.concat([Buffer.from(before, 'utf8'), Buffer.from([0xc3, 0x28]), Buffer.from(after, 'utf8')]),
  })
  await expect(workspace(page).getByRole('alert')).toContainText('not valid UTF-8')
  expect(await eventRows(page).allTextContents()).toEqual(previousEvents)
  expect(await alertRows(page).allTextContents()).toEqual(previousAlerts)
  await importCandidates(page)
  await expect(workspace(page).getByRole('alert')).toHaveCount(0)
})

test('unsupported EVTX, oversize files and excessive raw record counts preserve the current dataset', async ({ page }) => {
  await openWorkspace(page)
  await importCandidates(page)
  await importText(page, 'native.evtx', 'unsupported native event log', 'application/octet-stream')
  await expect(workspace(page).getByRole('alert')).toBeVisible()
  await expect(eventRows(page)).toHaveCount(7)
  await workspace(page).getByLabel('Import log file', { exact: true }).setInputFiles({
    name: 'too-large.json', mimeType: 'application/json', buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 0x20),
  })
  await expect(workspace(page).getByRole('alert')).toContainText(/5\s*(MiB|MB)|size|large/i)
  await expect(eventRows(page)).toHaveCount(7)
  await importText(page, 'too-many.json', JSON.stringify(Array.from({ length: 10_001 }, () => candidateEvents()[0])))
  await expect(workspace(page).getByRole('alert')).toContainText(/10[,.]?000|record|event|limit/i)
  await expect(eventRows(page)).toHaveCount(7)
})

test('a malformed supported record cannot silently replace the dataset with partial results', async ({ page }) => {
  await openWorkspace(page)
  await importCandidates(page)
  await importText(page, 'missing-host.json', JSON.stringify([...candidateEvents(), { ...candidateEvents()[0], host: '' }]))
  await expect(workspace(page).getByRole('alert')).toBeVisible()
  await expect(eventRows(page)).toHaveCount(7)
  await expect(alertRows(page)).toHaveCount(3)
})

test('XML entity declarations are rejected without requests or replacing previous evidence', async ({ page }) => {
  await openWorkspace(page)
  await importCandidates(page)
  const externalRequests: string[] = []
  page.on('request', (request) => { if (request.url().includes('untrusted.example')) externalRequests.push(request.url()) })
  const xml = `<!DOCTYPE Events [<!ENTITY stolen SYSTEM "https://untrusted.example/collect">]><Events>&stolen;</Events>`
  await importText(page, 'entity-export.xml', xml, 'application/xml')
  await expect(workspace(page).getByRole('alert')).toContainText(/DTD|entity/i)
  await expect(eventRows(page)).toHaveCount(7)
  await expect(alertRows(page)).toHaveCount(3)
  expect(externalRequests).toEqual([])
})

test('missing authentication identities are not combined into a misleading failure burst', async ({ page }) => {
  await openWorkspace(page)
  await importText(page, 'incomplete-identities.json', JSON.stringify(candidateEvents({ user: '', sourceIp: '' })))
  await expect(eventRows(page)).toHaveCount(7)
  await expect(alertRows(page)).toHaveCount(1)
  await expect(alertRows(page)).toContainText('Encoded PowerShell command')
  await workspace(page).getByText(/Data quality notices/).click()
  await expect(workspace(page).locator('.investigation-quality')).toContainText('excluded from R001/R002 correlation')
})

test('unsupported valid event types are counted and duplicate input IDs do not invent extra evidence', async ({ page }) => {
  await openWorkspace(page)
  const events = candidateEvents()
  await importText(page, 'mixed-observation.json', JSON.stringify([
    ...events,
    { ...events[0], id: 'input-id-is-not-evidence-identity' },
    { ...events[0], eventId: 4634 },
    { ...events[0], channel: 'Application', eventId: 7036 },
  ]))
  await expect(eventRows(page)).toHaveCount(7)
  await expect(alertRows(page)).toHaveCount(3)
  const metrics = workspace(page).locator('.investigation-metrics')
  await expect(metrics.locator('div').filter({ hasText: 'Duplicates removed' }).locator('dd')).toHaveText('1')
  await expect(metrics.locator('div').filter({ hasText: 'Unsupported records' }).locator('dd')).toHaveText('2')
  await workspace(page).getByText(/Data quality notices/).click()
  await expect(workspace(page).locator('.investigation-quality')).toContainText('unsupported record(s) skipped')
  await expect(workspace(page).locator('.investigation-quality')).toContainText('imported IDs are not trusted')
})

test('untrusted identifiers and command lines remain text, not executable markup or clickable URLs', async ({ page }) => {
  await openWorkspace(page)
  const markup = '<img src="https://untrusted.example/pixel" onerror="document.body.dataset.logInjected=1">'
  const user = '<script>document.body.dataset.logInjected=1</script>'
  const outbound: string[] = []
  page.on('request', (request) => { if (request.url().includes('untrusted.example')) outbound.push(request.url()) })
  await importCandidates(page, { host: markup, user, commandLine: `${privateCommand} ${markup}` })
  await expect(eventRows(page).first()).toContainText(markup)
  await alertRows(page).filter({ hasText: 'Encoded PowerShell command' }).click()
  const command = detail(page).locator('.investigation-evidence-row pre')
  await expect(command).toBeHidden()
  await detail(page).getByText('Inspect recorded command line (untrusted text)', { exact: true }).click()
  await expect(command).toBeVisible()
  await expect(command).toHaveText(`${privateCommand} ${markup}`)
  await expect(detail(page)).toContainText('No command is executed or decoded.')
  await expect(detail(page)).toContainText(markup)
  await expect(workspace(page).locator('img,script,iframe,a[href^="javascript:"]')).toHaveCount(0)
  expect(await page.locator('body').getAttribute('data-log-injected')).toBeNull()
  expect(outbound).toEqual([])
})

test('alert selection works with the keyboard and evidence remains chronological', async ({ page }) => {
  await openWorkspace(page)
  // Reverse source order to ensure timeline ordering is deliberate, not the input order.
  await importText(page, 'reverse-order.json', JSON.stringify(candidateEvents().reverse()))
  await expect(alertRows(page)).toHaveCount(3)
  const candidate = alertRows(page).filter({ hasText: 'Successful logon after repeated failures' })
  await candidate.focus()
  await page.keyboard.press('Enter')
  await expect(candidate).toHaveAttribute('aria-pressed', 'true')
  await expect(workspace(page).locator('.investigation-alert-row[aria-pressed="true"]')).toHaveCount(1)
  await expect(detail(page)).toContainText('Successful logon after repeated failures')
  const evidence = detail(page).locator('.investigation-evidence-row')
  await expect(evidence).toHaveCount(6)
  const timestamps = await evidence.locator('time').evaluateAll((elements) => elements.map((element) => element.getAttribute('datetime')))
  expect(timestamps).toHaveLength(6)
  expect(timestamps.every((timestamp) => timestamp && Number.isFinite(Date.parse(timestamp)))).toBe(true)
  expect(timestamps).toEqual([...timestamps].sort())
  expect(new Set(await evidence.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-event-id')))).size).toBe(6)
})

test('severity filters candidate alerts and search filters imported events independently', async ({ page }) => {
  await openWorkspace(page)
  await importCandidates(page)
  const severity = workspace(page).getByRole('group', { name: 'Candidate severity', exact: true })
  await severity.getByRole('button', { name: /^High\b/ }).click()
  await expect(alertRows(page)).toHaveCount(1)
  await expect(alertRows(page)).toContainText('Successful logon after repeated failures')
  await expect(eventRows(page)).toHaveCount(7)
  const search = workspace(page).getByLabel('Search imported logs', { exact: true })
  await search.fill('4625')
  await expect(eventRows(page)).toHaveCount(5)
  await expect(alertRows(page)).toHaveCount(1)
  await search.fill('no-such-local-host')
  await expect(eventRows(page)).toHaveCount(0)
  await expect(workspace(page)).toContainText(/no.*(event|record|match)/i)
  await search.fill('')
  await severity.getByRole('button', { name: /^All\b/ }).click()
  await expect(eventRows(page)).toHaveCount(7)
  await expect(alertRows(page)).toHaveCount(3)
})

test('event pagination retains the complete local dataset and searching resets the page', async ({ page }) => {
  await openWorkspace(page)
  const events = Array.from({ length: 53 }, (_, index) => ({
    ...candidateEvents()[5], timestamp: new Date(Date.UTC(2026, 9, 9, 10, 0, index)).toISOString(),
  }))
  await importText(page, 'paginated-logons.json', JSON.stringify(events))
  await expect(eventRows(page)).toHaveCount(50)
  await expect(alertRows(page)).toHaveCount(0)
  const pagination = workspace(page).getByRole('navigation', { name: 'Event pages', exact: true })
  await expect(pagination).toContainText('Page 1 of 2')
  await pagination.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(eventRows(page)).toHaveCount(3)
  await expect(pagination).toContainText('Page 2 of 2')
  await workspace(page).getByLabel('Search imported logs', { exact: true }).fill('4624')
  await expect(eventRows(page)).toHaveCount(50)
  await expect(pagination).toContainText('Page 1 of 2')
  await expect(workspace(page).locator('.investigation-event-count')).toContainText('53 matching events')
})

test('analyst review is an explicit assessment attached only to the selected candidate', async ({ page }) => {
  await openWorkspace(page)
  await importCandidates(page)
  const burst = alertRows(page).filter({ hasText: 'Repeated failed logons' })
  const encoded = alertRows(page).filter({ hasText: 'Encoded PowerShell command' })
  await burst.click()
  await detail(page).getByLabel('Analyst review', { exact: true }).selectOption('needs-follow-up')
  await expect(burst).toContainText('Needs follow-up')
  await expect(workspace(page).locator('.investigation-status')).toContainText('your assessment, not an automated verdict')
  await encoded.click()
  await expect(detail(page).getByLabel('Analyst review', { exact: true })).toHaveValue('unreviewed')
  await burst.click()
  await expect(detail(page).getByLabel('Analyst review', { exact: true })).toHaveValue('needs-follow-up')
  const pendingDownload = page.waitForEvent('download')
  await workspace(page).getByRole('button', { name: 'Export redacted JSON', exact: true }).click()
  const report = JSON.parse(await readDownload(await pendingDownload)) as { findings: { ruleId: string; review: string }[] }
  expect(report.findings.find((finding) => finding.ruleId === 'R001')?.review).toBe('needs-follow-up')
  expect(report.findings.find((finding) => finding.ruleId === 'R003')?.review).toBe('unreviewed')
})

for (const format of ['Markdown', 'JSON'] as const) {
  test(`${format} exports pseudonymize identifiers, remove command lines and keep candidate evidence`, async ({ page }) => {
    await openWorkspace(page)
    await importCandidates(page)
    const pendingDownload = page.waitForEvent('download')
    await workspace(page).getByRole('button', { name: `Export redacted ${format}`, exact: true }).click()
    const download = await pendingDownload
    const report = await readDownload(download)
    expect(download.suggestedFilename()).not.toMatch(/private|owned-lab/)
    expect(report).not.toContain(privateHost)
    expect(report).not.toContain(privateUser)
    expect(report).not.toContain(privateIp)
    expect(report).not.toContain('private-commandline-token')
    expect(report).not.toContain('C:\\Windows\\System32')
    expect(report).not.toContain('owned-lab.json')
    expect(report).toContain('R001')
    expect(report).toContain('R002')
    expect(report).toContain('R003')
    expect(report).toMatch(/candidate|not.*(proof|confirm)/i)
    if (format === 'JSON') {
      const data: unknown = JSON.parse(report)
      expect(fieldsIn(data, 'commandLine')).toEqual([])
      const hosts = fieldsIn(data, 'host').filter((value): value is string => typeof value === 'string' && Boolean(value))
      expect(hosts.length).toBeGreaterThanOrEqual(7)
      expect(new Set(hosts).size).toBe(1)
      const ips = fieldsIn(data, 'sourceIp').filter((value): value is string => typeof value === 'string' && /^ADDRESS-\d+$/.test(value))
      expect(ips.length).toBeGreaterThanOrEqual(6)
      expect(new Set(ips).size).toBe(1)
      expect(fieldsIn(data, 'processCategory')).toContain('PowerShell')
    }
  })
}

test('clear and reload leave no imported events in browser storage', async ({ page }) => {
  await openWorkspace(page)
  await importCandidates(page)
  const stored = await page.evaluate(async () => ({
    local: JSON.stringify(Object.entries(localStorage)),
    session: JSON.stringify(Object.entries(sessionStorage)),
    databases: typeof indexedDB.databases === 'function' ? (await indexedDB.databases()).map((entry) => entry.name) : [],
  }))
  expect(stored.local + stored.session + JSON.stringify(stored.databases)).not.toMatch(/private-workstation|private-log-owner|owned-lab/)
  await workspace(page).getByRole('button', { name: 'Clear local dataset', exact: true }).click()
  await expect(eventRows(page)).toHaveCount(0)
  await expect(alertRows(page)).toHaveCount(0)
  await expect(workspace(page).getByRole('button', { name: 'Export redacted JSON', exact: true })).toHaveCount(0)
  await importCandidates(page)
  await page.reload()
  await expect(eventRows(page)).toHaveCount(0)
  await expect(alertRows(page)).toHaveCount(0)
})

for (const width of [320, 390, 1440]) {
  test(`long imported evidence stays within the viewport at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await openWorkspace(page)
    await importCandidates(page, { host: `long-host-${'x'.repeat(220)}.example`, user: `long-user-${'y'.repeat(200)}`, commandLine: `${privateCommand} ${'z'.repeat(500)}` })
    await alertRows(page).filter({ hasText: 'Encoded PowerShell command' }).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const section = await workspace(page).boundingBox()
    expect(section).not.toBeNull()
    for (const button of await workspace(page).getByRole('button').all()) {
      if (!await button.isVisible()) continue
      const box = await button.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(section!.x - 1)
      expect(box!.x + box!.width).toBeLessThanOrEqual(section!.x + section!.width + 1)
    }
    expect(errors).toEqual([])
  })
}

test('all six navigation labels and touch targets remain visible at the narrowest supported width', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 })
  await openWorkspace(page)
  const navigation = page.getByRole('navigation', { name: 'Primary navigation', exact: true })
  const links = navigation.getByRole('link')
  await expect(links).toHaveCount(6)
  const navigationBox = await navigation.boundingBox()
  expect(navigationBox).not.toBeNull()
  for (const link of await links.all()) {
    await expect(link).toBeVisible()
    const box = await link.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.height).toBeGreaterThanOrEqual(44)
    expect(box!.width).toBeGreaterThanOrEqual(44)
    expect(box!.x).toBeGreaterThanOrEqual(navigationBox!.x - 1)
    expect(box!.x + box!.width).toBeLessThanOrEqual(navigationBox!.x + navigationBox!.width + 1)
    const text = await link.evaluate((element) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      const rect = range.getBoundingClientRect()
      const linkRect = element.getBoundingClientRect()
      return { x: rect.x, right: rect.right, left: linkRect.left, edge: linkRect.right }
    })
    expect(text.x).toBeGreaterThanOrEqual(text.left - 1)
    expect(text.right).toBeLessThanOrEqual(text.edge + 1)
  }
})

test('two-times text scaling keeps local investigation controls and navigation within their frames', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 })
  await openWorkspace(page)
  await importCandidates(page)
  const heading = page.locator('#workspace-heading-investigation')
  const initialSize = await heading.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
  await page.evaluate(() => {
    const sizes = Array.from(document.querySelectorAll<HTMLElement>('.workspace-view[data-workspace="investigation"], .workspace-view[data-workspace="investigation"] *, .nav-links a'))
      .map((element) => ({ element, size: Number.parseFloat(getComputedStyle(element).fontSize) }))
    for (const { element, size } of sizes) element.style.fontSize = `${size * 2}px`
  })
  expect(await heading.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(initialSize * 1.95)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  for (const selector of ['#investigation button', '#investigation input', '#investigation select', '.nav-links a']) {
    for (const element of await page.locator(selector).all()) {
      if (!await element.isVisible()) continue
      const box = await element.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(-1)
      expect(box!.x + box!.width).toBeLessThanOrEqual(391)
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }
  }
  const severityLabelLines = await workspace(page).getByRole('group', { name: 'Candidate severity', exact: true })
    .getByRole('button', { name: /^Medium\b/ }).evaluate((element) => {
      const label = Array.from(element.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes('Medium'))
      if (!label) return 0
      const range = document.createRange()
      range.selectNodeContents(label)
      return range.getClientRects().length
    })
  expect(severityLabelLines).toBe(1)
})
