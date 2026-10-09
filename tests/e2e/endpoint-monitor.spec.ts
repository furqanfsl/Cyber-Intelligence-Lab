import { test, expect, type Page } from '@playwright/test'
import type { EndpointSnapshot } from '../../shared/endpoint.ts'
import { intelligence } from './fixtures.ts'

// Browser fixtures exercise presentation only. They never read the test machine's logs.
const token = 'f'.repeat(64) // Explicit browser fixture, never a real session token.
const fixtureTime = () => new Date().toISOString()
function idle(): EndpointSnapshot {
  return { status: 'idle', platform: 'windows', includeSysmon: false, startedAt: null, lastAttemptAt: null, lastCheckedAt: null, nextCheckAt: null, pollInProgress: false, stale: false, error: null, defender: { state: 'unavailable', antivirusEnabled: null, realTimeProtectionEnabled: null, signaturesUpdatedAt: null }, coverage: ['defender', 'security', 'sysmon'].map((source) => ({ source: source as 'defender' | 'security' | 'sysmon', state: source === 'sysmon' ? 'not-requested' : 'unavailable', eventCount: 0, truncated: false, skippedCount: 0 })), defenderEvents: [], events: [], findings: [], retentionLimited: false, warnings: [], limits: { pollIntervalMs: 30000, queryWindowMs: 900000, retentionMs: 3600000, maxEvents: 2000, maxDefenderEvents: 200, maxFindings: 200, maxRetainedBytes: 2097152 } }
}
function running(): EndpointSnapshot {
  const value = idle(); const time = fixtureTime()
  return { ...value, status: 'running', startedAt: time, lastAttemptAt: time, lastCheckedAt: time, nextCheckAt: new Date(Date.now() + 30000).toISOString(), defender: { state: 'available', antivirusEnabled: true, realTimeProtectionEnabled: true, signaturesUpdatedAt: time }, coverage: value.coverage.map((source) => ({ ...source, state: source.source === 'defender' ? 'available' : source.state })) }
}
function findings(): EndpointSnapshot {
  const value = running(); const time = fixtureTime()
  value.includeSysmon = true
  value.coverage = value.coverage.map((source) => ({ ...source, state: 'available', eventCount: 1 }))
  value.defenderEvents = [{ id: 'fixture-defender-event', timestamp: time, eventId: 1116, detectionId: 'fixture-detection', threatId: 'fixture-threat-id', threatName: 'Explicit browser fixture threat', severity: 'high', actionId: null, errorCode: '' }]
  value.events = [{ id: 'fixture-process', timestamp: time, host: 'PRIVATE-FIXTURE-COMPUTER', user: 'PRIVATE-FIXTURE-ACCOUNT', channel: 'Sysmon', eventId: 1, sourceIp: '198.51.100.23', process: 'C:\\PRIVATE-FIXTURE-PATH\\powershell.exe', commandLine: 'powershell -enc PRIVATE-FIXTURE-COMMAND' }]
  value.findings = [
    { id: 'fixture-defender', kind: 'defender', state: 'needs-review', title: 'Explicit browser fixture Defender finding', severity: 'high', summary: 'This fixture tests provider presentation, not a real detection.', ruleId: null, firstSeen: time, lastSeen: time, evidenceIds: ['fixture-defender-event'], nextSteps: ['Review the matching Protection history entry.'], falsePositives: [] },
    { id: 'fixture-candidate', kind: 'candidate', state: 'needs-review', title: 'Explicit browser fixture encoded PowerShell', severity: 'medium', summary: 'This fixture tests a candidate rule; it is not proof of malware.', ruleId: 'R003', firstSeen: time, lastSeen: time, evidenceIds: ['fixture-process'], nextSteps: ['Compare the process with authorised automation.'], falsePositives: ['Legitimate automation may use the same flag.'] },
  ]
  return value
}
type Calls = { path: string; method: string; body: string | null; headers: Record<string, string> }[]
async function fixture(page: Page, initial: EndpointSnapshot = idle()) {
  let current = initial
  let failed = false
  const calls: Calls = []
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: intelligence }))
  await page.route('**/api/endpoint/*', async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname.split('/').at(-1)!
    calls.push({ path, method: request.method(), body: request.postData(), headers: request.headers() })
    if (failed && path === 'status') return route.fulfill({ status: 503, json: { code: 'endpoint_unavailable', message: 'PRIVATE-ERROR-MUST-NOT-LEAK' } })
    if (path === 'session') return route.fulfill({ json: { token, platform: 'windows', available: true } })
    if (path === 'start') { current = findings(); current.includeSysmon = Boolean(request.postDataJSON()?.includeSysmon) }
    if (path === 'stop') current = { ...idle(), status: 'stopped' }
    return route.fulfill({ json: current })
  })
  return { calls, set: (value: EndpointSnapshot) => { current = value }, fail: () => { failed = true } }
}
const section = (page: Page) => page.locator('#endpoint')
async function open(page: Page) { await page.goto('/#endpoint'); await expect(section(page).getByRole('heading', { name: 'Understand what your PC reports.' })).toBeVisible(); await expect(section(page).getByRole('button', { name: 'Reconnect local service' })).toBeEnabled() }
const rows = (page: Page) => section(page).locator('.endpoint-alert')

test('real workspace never starts collection automatically or loads teaching data', async ({ page }) => {
  const state = await fixture(page); await open(page)
  await expect(section(page).getByText('Ready when you are', { exact: true })).toBeVisible()
  await expect(section(page).getByRole('button', { name: 'Start monitoring this PC' })).toBeDisabled()
  await expect(section(page).getByRole('button', { name: /sample/i })).toHaveCount(0)
  expect(state.calls.every((call) => call.method === 'GET')).toBe(true)
  expect(state.calls.map((call) => call.path)).toEqual(['session', 'status'])
  for (const call of state.calls) expect(call.headers['x-cyber-lab-endpoint-client']).toBe('1')
  expect(state.calls[0].headers['x-cyber-lab-endpoint-token']).toBeUndefined()
  expect(state.calls[1].headers['x-cyber-lab-endpoint-token']).toBe(token)
  await expect(section(page).getByText('Not checked yet', { exact: true })).toHaveCount(2)
})

test('explicit consent starts bounded monitoring and stop clears private history and reviews', async ({ page }) => {
  const state = await fixture(page); await open(page)
  await section(page).getByLabel('I own or am authorised', { exact: false }).check()
  await section(page).getByText('What gets read & optional process coverage', { exact: true }).click()
  await section(page).getByLabel('Also read existing Sysmon', { exact: false }).check()
  await section(page).getByRole('button', { name: 'Start monitoring this PC' }).click()
  await expect(section(page).getByText('Monitoring this PC', { exact: true })).toBeVisible()
  const start = state.calls.find((call) => call.path === 'start')!
  expect(start.method).toBe('POST'); expect(JSON.parse(start.body!)).toEqual({ includeSysmon: true }); expect(start.headers['x-cyber-lab-endpoint-token']).toBe(token)
  await expect(rows(page)).toHaveCount(2)
  await section(page).getByLabel('Your analyst review · this tab only').selectOption('follow-up')
  await section(page).getByRole('button', { name: 'Stop and clear monitoring' }).click()
  await expect(section(page).getByText('Monitoring stopped', { exact: true })).toBeVisible()
  await expect(rows(page)).toHaveCount(0)
  expect(state.calls.find((call) => call.path === 'stop')?.body).toBe('{}')
  await expect(section(page).getByText('PRIVATE-FIXTURE-COMPUTER')).toHaveCount(0)
})

test('unsupported bootstrap cannot poll private status or imply a clean PC', async ({ page }) => {
  const calls: string[] = []
  await page.clock.install()
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: intelligence }))
  await page.route('**/api/endpoint/*', (route) => { calls.push(route.request().url()); return route.fulfill({ json: { token: '', platform: 'unsupported', available: false } }) })
  await open(page); await page.clock.fastForward(15000)
  await expect(section(page).getByText('Local monitoring unavailable', { exact: true })).toBeVisible()
  await expect(section(page).getByRole('button', { name: 'Start monitoring this PC' })).toBeDisabled()
  expect(calls).toHaveLength(1)
  await expect(section(page).getByText('Use start.bat or npm run dev', { exact: false })).toBeVisible()
  await expect(section(page).getByText('Safe', { exact: true })).toHaveCount(0)
})

test('remote rejection explains local companion requirement without leaking server errors', async ({ page }) => {
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: intelligence }))
  await page.route('**/api/endpoint/*', (route) => route.fulfill({ status: 403, json: { code: 'endpoint_local_only', message: 'PRIVATE-SERVER-PATH' } }))
  await open(page)
  await expect(section(page).getByRole('alert')).toContainText('A publicly hosted website cannot read your device')
  await expect(section(page).getByText('A public website cannot inspect your PC', { exact: false })).toBeVisible()
  expect(await section(page).innerText()).not.toContain('PRIVATE-SERVER-PATH')
})

test('a public-host browser copy never requests private bootstrap or collector data', async ({ page, baseURL }) => {
  const privateRequests: string[] = []
  // Intercept a reserved .example origin and serve only this build's static assets.
  // No public server, private telemetry or external network request is involved.
  await page.route('http://public-browser-fixture.example/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/api/endpoint/')) { privateRequests.push(url.pathname); return route.abort() }
    if (url.pathname === '/api/live-intel') return route.fulfill({ json: intelligence })
    const response = await route.fetch({ url: `${baseURL}${url.pathname}${url.search}` })
    return route.fulfill({ response })
  })
  await page.goto('http://public-browser-fixture.example/#endpoint')
  await expect(section(page).getByRole('alert')).toContainText('A publicly hosted website cannot read your device')
  await expect(section(page).getByRole('button', { name: 'Start monitoring this PC' })).toBeDisabled()
  await section(page).getByRole('button', { name: 'Reconnect local service' }).click()
  await expect(section(page).getByRole('alert')).toBeVisible()
  expect(privateRequests).toEqual([])
})

test('real source limits and protection concerns are explicit rather than healthy badges', async ({ page }) => {
  const value = running(); value.defender.realTimeProtectionEnabled = false; value.coverage[0].truncated = true; value.coverage[0].skippedCount = 3; value.warnings = ['Explicit fixture source limit']; value.retentionLimited = true
  await fixture(page, value); await open(page)
  await expect(section(page).getByText('Unavailable or permission denied', { exact: true })).toHaveCount(1)
  await expect(section(page).getByText('Microsoft Defender real-time protection is not enabled.', { exact: true })).toBeVisible()
  await expect(section(page).getByText('Another antivirus or organisational policy', { exact: false })).toBeVisible()
  await expect(section(page).getByText('No findings were returned', { exact: false })).toBeVisible()
  await expect(section(page).getByText('Source query reached its limit', { exact: false })).toBeVisible()
  await section(page).getByText('Collection limits & warnings', { exact: true }).click()
  await expect(section(page).getByText('Explicit fixture source limit', { exact: true })).toBeVisible()
})

test('Defender outcomes remain provider observations, with UTC evidence and manual review', async ({ page }) => {
  const value = findings(); value.findings[0].state = 'action-recorded'
  await fixture(page, value); await open(page)
  await rows(page).filter({ hasText: 'Explicit browser fixture Defender finding' }).click()
  await expect(section(page).locator('.endpoint-detail')).toContainText('Defender action recorded')
  await expect(section(page).locator('.endpoint-evidence')).toContainText('Threat detected by Defender · Event 1116')
  await expect(section(page).locator('.endpoint-evidence time')).toContainText(' UTC')
  await section(page).getByText('Show Defender record identifiers', { exact: true }).click()
  await expect(section(page).getByText('fixture-detection', { exact: true })).toBeVisible()
  await section(page).getByLabel('Your analyst review · this tab only').selectOption('expected-activity')
  await expect(rows(page).filter({ hasText: 'Explicit browser fixture Defender finding' })).toContainText('Analyst: expected activity')
  await expect(section(page).getByText('A manual review does not resolve a threat', { exact: false })).toBeVisible()
  await page.reload(); await expect(section(page).getByLabel('Your analyst review · this tab only')).toHaveValue('unreviewed')
})

test('candidate identities and command lines require deliberate disclosure and never execute', async ({ page }) => {
  const value = findings(); value.events[0].commandLine = '<img src=x onerror="window.fixtureExecuted=true"> PRIVATE-FIXTURE-COMMAND'
  const state = await fixture(page, value); await open(page)
  await rows(page).filter({ hasText: 'Explicit browser fixture encoded PowerShell' }).click()
  expect(await section(page).innerText()).not.toContain('PRIVATE-FIXTURE-COMPUTER')
  await section(page).getByText('Show private event details', { exact: true }).click()
  await expect(section(page).getByText('PRIVATE-FIXTURE-COMPUTER', { exact: true })).toBeVisible()
  await expect(section(page).getByText(value.events[0].commandLine, { exact: true })).toBeVisible()
  await expect(section(page).locator('.endpoint-sensitive img')).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { fixtureExecuted?: boolean }).fixtureExecuted)).toBeUndefined()
  expect(state.calls.every((call) => call.method === 'GET')).toBe(true)
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))
  expect(storage).not.toMatch(/PRIVATE-FIXTURE/)
  expect(storage).not.toContain(token)
})

test('queue filters, searches and pagination retain honest categories', async ({ page }) => {
  const value = findings(); value.findings.push(...Array.from({ length: 12 }, (_, index) => ({ ...value.findings[1], id: `fixture-extra-${index}`, title: `Explicit browser fixture extra ${index}` })))
  await fixture(page, value); await open(page)
  await expect(rows(page)).toHaveCount(10)
  await section(page).getByRole('button', { name: 'Next findings' }).click(); await expect(rows(page)).toHaveCount(4)
  await section(page).getByRole('button', { name: 'Defender', exact: true }).click(); await expect(rows(page)).toHaveCount(1)
  await section(page).getByRole('button', { name: 'Rule matches', exact: true }).click(); await expect(rows(page)).toHaveCount(10)
  await section(page).getByLabel('Search returned findings').fill('extra 11'); await expect(rows(page)).toHaveCount(1)
  await section(page).getByLabel('Search returned findings').fill('not-existing'); await expect(rows(page)).toHaveCount(0)
  await expect(section(page).getByText('No returned findings match this filter.', { exact: true })).toBeVisible()
})

test('failed refresh keeps earlier evidence but marks current protection unknown', async ({ page }) => {
  await page.clock.install()
  const state = await fixture(page, findings()); await open(page); state.fail(); await page.clock.fastForward(5100)
  await expect(section(page).getByText('Monitoring status unknown', { exact: true })).toBeVisible()
  await expect(section(page).getByRole('alert')).toContainText('Previously returned records remain visible')
  await expect(rows(page)).toHaveCount(2)
  expect(await section(page).innerText()).not.toContain('PRIVATE-ERROR-MUST-NOT-LEAK')
})

test('failed reconnect cannot leave a silently unusable stop control', async ({ page }) => {
  const state = await fixture(page, findings()); await open(page); state.fail()
  await section(page).getByRole('button', { name: 'Reconnect local service' }).click()
  await expect(section(page).getByRole('button', { name: 'Reconnect to stop monitoring' })).toBeDisabled()
  await expect(section(page).getByRole('alert')).toContainText('The collector may still be running')
  await expect(section(page).getByRole('alert')).toContainText('Ctrl+C')
  await expect(section(page).getByText('Monitoring status unknown', { exact: true })).toBeVisible()
  await expect(section(page).getByText('Collector status not verified', { exact: true })).toBeVisible()
  await expect(section(page).getByText('Collector running', { exact: true })).toHaveCount(0)
  await expect(rows(page)).toHaveCount(2)
})

test('running collector with no readable event source does not imply active event coverage', async ({ page }) => {
  const value = running(); value.coverage = value.coverage.map((source) => ({ ...source, state: source.source === 'sysmon' ? 'not-requested' : 'unavailable' }))
  await fixture(page, value); await open(page)
  await expect(section(page).getByText('Status only · event sources unavailable', { exact: true })).toBeVisible()
  await expect(section(page).getByText('Monitoring this PC', { exact: true })).toHaveCount(0)
})

test('partial Defender status never turns unknown protection settings into zero concerns', async ({ page }) => {
  const value = running(); value.defender.realTimeProtectionEnabled = null
  await fixture(page, value); await open(page)
  const metric = section(page).locator('.endpoint-metrics > div').filter({ hasText: 'Protection concerns reported' })
  await expect(metric.locator('dd')).toContainText('—')
  await expect(metric).toContainText('Some Defender settings were not reported')
})

test('malformed collector metadata cannot create a safety badge or a fictional finding', async ({ page }) => {
  const value = findings() as unknown as Record<string, unknown>; value.status = 'safe'
  await fixture(page, value as unknown as EndpointSnapshot); await open(page)
  await expect(section(page).getByRole('alert')).toContainText('invalid response')
  await expect(rows(page)).toHaveCount(0)
})

test('tab notifications require a gesture and report only post-baseline generic batches', async ({ page }) => {
  await page.clock.install()
  await page.addInitScript(() => {
    const calls: { title: string; body: string }[] = []
    let asked = 0
    class FixtureNotification {
      static permission = 'default'
      static async requestPermission() { asked += 1; FixtureNotification.permission = 'granted'; return 'granted' }
      constructor(title: string, options: { body: string }) { calls.push({ title, body: options.body }) }
    }
    Object.defineProperty(window, 'Notification', { value: FixtureNotification, configurable: true })
    Object.assign(window, { fixtureNotifications: calls, fixtureNotificationRequests: () => asked })
  })
  const value = findings(); const state = await fixture(page, value); await open(page)
  expect(await page.evaluate(() => (window as unknown as { fixtureNotificationRequests(): number }).fixtureNotificationRequests())).toBe(0)
  await section(page).getByText('Optional notifications while this tab is open', { exact: true }).click()
  await section(page).getByRole('button', { name: 'Enable tab notifications' }).click()
  expect(await page.evaluate(() => (window as unknown as { fixtureNotifications: unknown[] }).fixtureNotifications.length)).toBe(0)
  value.findings.push({ ...value.findings[0], id: 'new-explicit-fixture', title: 'PRIVATE-NEW-DETECTION-TITLE' }); state.set(value); await page.clock.fastForward(5100)
  await expect.poll(() => page.evaluate(() => (window as unknown as { fixtureNotifications: unknown[] }).fixtureNotifications.length)).toBe(1)
  const sent = await page.evaluate(() => JSON.stringify((window as unknown as { fixtureNotifications: unknown[] }).fixtureNotifications))
  expect(sent).not.toMatch(/PRIVATE|Explicit|encoded|Defender finding/)
  await section(page).getByRole('button', { name: 'Disable tab notifications' }).click()
  value.findings.push({ ...value.findings[0], id: 'other-new-fixture' }); state.set(value); await page.clock.fastForward(5100)
  expect(await page.evaluate(() => (window as unknown as { fixtureNotifications: unknown[] }).fixtureNotifications.length)).toBe(1)
})

test('mobile and doubled text remain readable with contained layout and generous controls', async ({ page }) => {
  await fixture(page, findings()); await page.setViewportSize({ width: 320, height: 844 }); await open(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
  const tiny = await section(page).locator('button').evaluateAll((buttons) => buttons.filter((button) => { const rect = button.getBoundingClientRect(); return rect.width < 44 || rect.height < 44 }).map((button) => button.textContent))
  expect(tiny).toEqual([])
  const heading = page.locator('#workspace-heading-endpoint')
  const initialSize = await heading.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
  await page.evaluate(() => {
    const sizes = Array.from(document.querySelectorAll<HTMLElement>('.workspace-view[data-workspace="endpoint"], .workspace-view[data-workspace="endpoint"] *')).map((element) => ({ element, size: Number.parseFloat(getComputedStyle(element).fontSize) }))
    for (const { element, size } of sizes) element.style.fontSize = `${size * 2}px`
  })
  expect(await heading.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(initialSize * 1.95)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
  await expect(section(page).getByRole('button', { name: 'Rule matches', exact: true })).toBeVisible()
})
