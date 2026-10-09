import { expect, test, type Page } from '@playwright/test'
import type { EndpointSnapshot } from '../../shared/endpoint.ts'
import { intelligence } from './fixtures.ts'
import { navigateWorkspace, type Workspace } from './workspace-helpers.ts'

const routes = [
  ['overview', '#overview', 'Your security workspace.'],
  ['endpoint', '#endpoint', 'PC monitoring'],
  ['investigation', '#investigation', 'Log investigation'],
  ['live-intel', '#live-intel', 'Live intelligence'],
  ['training', '#operations', 'Training'],
] as const

const fixtureToken = 'a'.repeat(64) // A browser fixture, never an actual private session token.
function endpointFixture(): EndpointSnapshot {
  return {
    status: 'idle', platform: 'windows', includeSysmon: false, startedAt: null,
    lastAttemptAt: null, lastCheckedAt: null, nextCheckAt: null, pollInProgress: false,
    stale: false, error: null,
    defender: { state: 'unavailable', antivirusEnabled: null, realTimeProtectionEnabled: null, signaturesUpdatedAt: null },
    coverage: [
      { source: 'defender', state: 'unavailable', eventCount: 0, truncated: false, skippedCount: 0 },
      { source: 'security', state: 'unavailable', eventCount: 0, truncated: false, skippedCount: 0 },
      { source: 'sysmon', state: 'not-requested', eventCount: 0, truncated: false, skippedCount: 0 },
    ],
    defenderEvents: [], events: [], findings: [], retentionLimited: false, warnings: [],
    limits: { pollIntervalMs: 30000, queryWindowMs: 900000, retentionMs: 3600000, maxEvents: 2000, maxDefenderEvents: 200, maxFindings: 200, maxRetainedBytes: 2097152 },
  }
}

async function privateFixture(page: Page) {
  const calls: { path: string; method: string }[] = []
  let current = endpointFixture()
  await page.route('**/api/endpoint/*', (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.split('/').at(-1)!
    calls.push({ path, method: request.method() })
    if (path === 'session') return route.fulfill({ json: { token: fixtureToken, platform: 'windows', available: true } })
    if (path === 'start') {
      const time = new Date().toISOString()
      current = {
        ...endpointFixture(), status: 'running', startedAt: time, lastAttemptAt: time,
        lastCheckedAt: time, nextCheckAt: new Date(Date.now() + 30000).toISOString(),
        defender: { state: 'available', antivirusEnabled: true, realTimeProtectionEnabled: true, signaturesUpdatedAt: time },
        coverage: endpointFixture().coverage.map((source) => ({ ...source, state: source.source === 'defender' ? 'available' : source.state })),
      }
    }
    if (path === 'stop') current = { ...endpointFixture(), status: 'stopped' }
    return route.fulfill({ json: current })
  })
  return calls
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: intelligence }))
  // Every private request in this suite is mocked: no test can read real PC logs.
  await privateFixture(page)
})

test('overview is a compact task launcher, not a stack of every feature', async ({ page }) => {
  const privateRequests: string[] = []
  page.on('request', (request) => { if (request.url().includes('/api/endpoint/')) privateRequests.push(request.url()) })
  await page.goto('/')
  await expect(page.locator('.workspace-view:visible')).toHaveAttribute('data-workspace', 'overview')
  await expect(page.locator('.workspace-view')).toHaveCount(1)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your security workspace.')
  await expect(page.locator('#endpoint, #investigation, #live-intel, #operations, #response, #cases')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Monitor this PC', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Investigate local logs', exact: true })).toBeVisible()
  await expect(page.locator('.nav-links a')).toHaveText(['Overview', 'PC', 'Logs', 'Live intel', 'Training'])
  await expect(page.locator('.nav-links a[aria-current="page"]')).toHaveText('Overview')
  expect(privateRequests).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

for (const [workspace, hash, heading] of routes) {
  test(`${workspace} direct links and reload show only the requested workspace`, async ({ page }) => {
    await page.goto(`/${hash}`)
    await expect(page.locator('.workspace-view:visible')).toHaveCount(1)
    await expect(page.locator('.workspace-view:visible')).toHaveAttribute('data-workspace', workspace)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading)
    await expect(page.locator(`.nav-links a[href="${hash}"]`)).toHaveAttribute('aria-current', 'page')
    await expect(page.locator('.nav-links a[aria-current]')).toHaveCount(1)
    await page.reload()
    await expect(page.locator('.workspace-view:visible')).toHaveAttribute('data-workspace', workspace)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('retired Cases content and invented outcome metrics cannot return through any workspace or old bookmark', async ({ page }) => {
  await page.goto('/#cases')
  await expect(page.locator('.workspace-view:visible')).toHaveAttribute('data-workspace', 'training')
  for (const [workspace] of routes) {
    await navigateWorkspace(page, workspace)
    await expect(page.locator('#cases, .case-section, .case-table, .case-row, .workspace-view[data-workspace="cases"]')).toHaveCount(0)
    await expect(page.locator('a[href="#cases"]')).toHaveCount(0)
    for (const label of ['Practice cases', 'Practice scenarios. Example outcomes.', 'Illustrative target', '> 99%', '> 92%', '> 70', 'threat contained', 'traffic reduction target', 'example risk findings', '1,200 sample endpoints', '17 example domains']) {
      await expect(page.getByText(label, { exact: true })).toHaveCount(0)
    }
  }
  await expect(page.locator('.workspace-view')).toHaveCount(5)
  await navigateWorkspace(page, 'training')
  await expect(page.locator('.queue-row')).toHaveCount(5)
  await expect(page.getByRole('button', { name: 'Start simulation', exact: true })).toBeVisible()
})

test('overview has one compact footer at the desktop bottom, without repeated branding or a large top CTA', async ({ page }) => {
  for (const width of [1440, 1853]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/#overview')
    await page.evaluate(() => document.fonts.ready)
    const footer = page.getByRole('contentinfo')
    await expect(footer).toHaveCount(1)
    await expect(footer).toHaveAttribute('data-workspace', 'overview')
    await expect(footer.locator('.workspace-footer-note')).toHaveCount(1)
    await expect(page.locator('.workspace-overview-note')).toHaveCount(0)
    await expect(footer.getByRole('link')).toHaveCount(0)
    await expect(footer.locator('.button, .brand, strong')).toHaveCount(0)
    await expect(footer).not.toContainText('Cyber Intelligence Lab')
    const scope = await footer.locator('.workspace-footer-note').innerText()
    expect(scope).toContain('Monitoring is opt-in')
    expect(scope).toContain('Logs stay in this tab')
    expect(scope).toContain('Public feeds and fictional training are not PC detections')
    expect((await page.locator('body').innerText()).split(scope)).toHaveLength(2)
    const bounds = await footer.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.y + bounds!.height).toBeGreaterThanOrEqual(999)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(1001)
    expect(bounds!.height).toBeLessThanOrEqual(110)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

test('Back and Forward restore focused views without a full-page reset', async ({ page }) => {
  await page.goto('/#overview')
  await navigateWorkspace(page, 'investigation')
  await navigateWorkspace(page, 'live-intel')
  await navigateWorkspace(page, 'training')
  await page.goBack()
  await expect(page.locator('.workspace-view:visible')).toHaveAttribute('data-workspace', 'live-intel')
  await expect(page.locator('.nav-links a[href="#live-intel"]')).toHaveAttribute('aria-current', 'page')
  await page.goBack()
  await expect(page.locator('.workspace-view:visible')).toHaveAttribute('data-workspace', 'investigation')
  await page.goForward()
  await expect(page.locator('.workspace-view:visible')).toHaveAttribute('data-workspace', 'live-intel')
  await expect(page.locator('.workspace-view:visible')).toHaveCount(1)
})

test('legacy top and response links select the correct view and subsection', async ({ page }) => {
  await page.goto('/#top')
  await expect(page.locator('.workspace-view:visible')).toHaveAttribute('data-workspace', 'overview')
  await page.goto('/#response')
  await expect(page.locator('.workspace-view:visible')).toHaveAttribute('data-workspace', 'training')
  await expect(page.locator('.nav-links a[href="#operations"]')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('#response')).toBeVisible()
  await expect(page.locator('#response')).toBeFocused()
  await expect(page.locator('#response h2')).toBeInViewport()
  await page.goto('/#training')
  await expect(page.locator('.workspace-view:visible')).toHaveAttribute('data-workspace', 'training')
  await page.goto('/#live-intelligence')
  await expect(page.locator('.workspace-view:visible')).toHaveAttribute('data-workspace', 'live-intel')
  await page.goto('/#cases')
  await expect(page.locator('.workspace-view:visible')).toHaveAttribute('data-workspace', 'training')
  await expect(page.locator('.nav-links a[href="#operations"]')).toHaveAttribute('aria-current', 'page')
})

test('unknown and malformed routes offer recovery without initializing private monitoring', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => { if (request.url().includes('/api/endpoint/')) requests.push(request.url()) })
  for (const hash of ['#unknown-workspace', '#%E0%A4%A']) {
    await page.goto(`/${hash}`)
    await expect(page.getByRole('heading', { name: 'Workspace not found', exact: true })).toBeVisible()
    await expect(page.locator('.workspace-view:visible')).toHaveCount(1)
    await expect(page.locator('.nav-links a[aria-current]')).toHaveCount(0)
    await expect(page.getByRole('contentinfo')).toHaveCount(0)
    await page.getByRole('link', { name: 'Open overview', exact: true }).click()
    await expect(page.locator('.workspace-view:visible')).toHaveAttribute('data-workspace', 'overview')
  }
  expect(requests).toEqual([])
})

test('imported evidence, search and analyst review survive workspace changes only in tab memory', async ({ page }) => {
  await page.goto('/#investigation')
  const logs = page.locator('#investigation')
  const privateMarker = 'PRIVATE-WORKSPACE-TEST-HOST'
  await logs.getByLabel('Import log file', { exact: true }).setInputFiles({
    name: 'workspace-retention.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify([{ timestamp: '2026-10-09T12:00:00.000Z', host: privateMarker, channel: 'Sysmon', eventId: 1, user: 'fixture-user', sourceIp: '', process: 'powershell.exe', commandLine: 'powershell.exe -EncodedCommand U0FGRQ==' }]), 'utf8'),
  })
  await expect(logs.locator('.investigation-event-row')).toHaveCount(1)
  await logs.locator('.investigation-alert-row').click()
  await logs.getByLabel('Analyst review', { exact: true }).selectOption('needs-follow-up')
  await logs.getByLabel('Search imported logs', { exact: true }).fill(privateMarker)
  await navigateWorkspace(page, 'live-intel')
  const hidden = page.locator('.workspace-view[data-workspace="investigation"]')
  await expect(hidden).toBeHidden()
  await expect(hidden).toHaveAttribute('hidden', '')
  await expect(hidden).toHaveAttribute('inert', '')
  await logs.getByLabel('Search imported logs', { exact: true }).evaluate((input) => input.focus())
  expect(await hidden.evaluate((element) => element.contains(document.activeElement))).toBe(false)
  await navigateWorkspace(page, 'investigation')
  await expect(logs.locator('.investigation-event-row')).toHaveCount(1)
  await expect(logs.getByLabel('Search imported logs', { exact: true })).toHaveValue(privateMarker)
  await expect(logs.getByLabel('Analyst review', { exact: true })).toHaveValue('needs-follow-up')
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))
  expect(stored).not.toContain(privateMarker)
  await page.reload()
  await expect(logs.locator('.investigation-event-row')).toHaveCount(0)
})

test('PC consent is retained and navigation never stops an explicitly started mocked collector', async ({ page }) => {
  await page.clock.install()
  const calls = await privateFixture(page)
  await page.goto('/#overview')
  expect(calls).toEqual([])
  await navigateWorkspace(page, 'endpoint')
  const pc = page.locator('#endpoint')
  await expect(pc.getByRole('button', { name: 'Reconnect local service' })).toBeEnabled()
  await pc.getByLabel('I own or am authorised', { exact: false }).check()
  await navigateWorkspace(page, 'live-intel')
  await navigateWorkspace(page, 'endpoint')
  await expect(pc.getByLabel('I own or am authorised', { exact: false })).toBeChecked()
  expect(calls.filter((call) => call.method === 'POST')).toEqual([])
  await pc.getByRole('button', { name: 'Start monitoring this PC', exact: true }).click()
  await expect(pc.getByText('Monitoring this PC', { exact: true })).toBeVisible()
  const checks = calls.filter((call) => call.path === 'status').length
  await navigateWorkspace(page, 'live-intel')
  await page.clock.fastForward(5100)
  await expect.poll(() => calls.filter((call) => call.path === 'status').length).toBeGreaterThan(checks)
  expect(calls.filter((call) => call.path === 'stop')).toEqual([])
  await navigateWorkspace(page, 'endpoint')
  await expect(pc.getByText('Monitoring this PC', { exact: true })).toBeVisible()
  await pc.getByRole('button', { name: 'Stop and clear monitoring', exact: true }).click()
  await expect(pc.getByText('Monitoring stopped', { exact: true })).toBeVisible()
  expect(calls.filter((call) => call.path === 'stop')).toHaveLength(1)
})

test('leaving Training pauses its simulation without resetting evidence or silently resuming', async ({ page }) => {
  await page.clock.install()
  await page.goto('/#operations')
  await page.getByRole('button', { name: 'Start simulation', exact: true }).click()
  await expect(page.locator('.simulation-session-count')).toHaveText('+7')
  const session = await page.locator('.simulation-console').getAttribute('data-session-id')
  await navigateWorkspace(page, 'live-intel')
  await page.clock.fastForward(26000)
  await navigateWorkspace(page, 'training')
  await expect(page.locator('.simulation-console')).toHaveAttribute('data-state', 'paused')
  await expect(page.locator('.simulation-console')).toHaveAttribute('data-session-id', session!)
  await expect(page.locator('.simulation-session-count')).toHaveText('+7')
  await page.clock.fastForward(5200)
  await expect(page.locator('.simulation-session-count')).toHaveText('+7')
  await page.getByRole('button', { name: 'Resume simulation', exact: true }).click()
  await page.clock.fastForward(2600)
  await expect(page.locator('.simulation-session-count')).toHaveText('+14')
})

test('a browser route change closes the training modal and releases background scrolling', async ({ page }) => {
  await page.goto('/#operations')
  await page.locator('.queue-row').first().click()
  await expect(page.locator('dialog.incident-workspace')).toBeVisible()
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden')
  await page.evaluate(() => { window.location.hash = '#live-intel' })
  await expect(page.locator('dialog.incident-workspace')).toBeHidden()
  await expect(page.locator('.workspace-view:visible')).toHaveAttribute('data-workspace', 'live-intel')
  expect(await page.locator('body').evaluate((element) => element.style.overflow)).toBe('')
  await navigateWorkspace(page, 'training')
  await expect(page.locator('dialog.incident-workspace')).toBeHidden()
})

test('skip and footer links focus the current workspace rather than opening another page', async ({ page }) => {
  await page.goto('/#live-intel')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#main-content')).toBeFocused()
  await expect(page.locator('.workspace-view:visible')).toHaveAttribute('data-workspace', 'live-intel')
  await page.getByRole('link', { name: /Back to top/ }).click()
  await expect(page).toHaveURL(/#live-intel$/)
  await expect(page.locator('#workspace-heading-live-intel')).toBeFocused()
  await expect(page.locator('#workspace-heading-live-intel')).toBeInViewport()
  for (const [workspace, hash] of routes.filter(([workspace]) => workspace !== 'overview')) {
    await navigateWorkspace(page, workspace)
    const footer = page.getByRole('contentinfo')
    await expect(footer).toHaveAttribute('data-workspace', workspace)
    await expect(footer.locator('.workspace-footer-note')).toHaveCount(1)
    const top = footer.getByRole('link', { name: /Back to top/ })
    await expect(top).toHaveAttribute('href', hash)
    await expect(top).toHaveClass('workspace-back-top')
    await expect(footer.locator('.button, .brand, strong')).toHaveCount(0)
    await expect(top).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    const bounds = await top.boundingBox()
    expect(bounds!.height).toBeGreaterThanOrEqual(44)
    expect(bounds!.width).toBeLessThanOrEqual(200)
    await top.click()
    await expect(page).toHaveURL(new RegExp(`${hash}$`))
    await expect(page.locator(`#workspace-heading-${workspace}`)).toBeFocused()
    await expect(page.locator(`#workspace-heading-${workspace}`)).toBeInViewport()
  }
})

test('PC and Logs use the same page frame without the reported stepped section widths', async ({ page }) => {
  await page.setViewportSize({ width: 1853, height: 900 })
  await page.goto('/#endpoint')
  const pc = await page.locator('#endpoint').boundingBox()
  await navigateWorkspace(page, 'investigation')
  const logs = await page.locator('#investigation').boundingBox()
  expect(pc).not.toBeNull(); expect(logs).not.toBeNull()
  expect(Math.abs(pc!.x - logs!.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(pc!.width - logs!.width)).toBeLessThanOrEqual(1)
  await expect(page.locator('#endpoint')).toBeHidden()
  await expect(page.locator('.workspace-view:visible')).toHaveCount(1)
})

test('five navigation targets remain readable and usable at 320px and twice the text size', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 1000 })
  await page.goto('/#overview')
  const navigation = page.getByRole('navigation', { name: 'Primary navigation', exact: true })
  await expect(navigation.getByRole('link')).toHaveCount(5)
  const initialSize = await navigation.getByRole('link').first().evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
  await page.evaluate(() => {
    const sizes = Array.from(document.querySelectorAll<HTMLElement>('.nav-frame *, .workspace-overview, .workspace-overview *'))
      .map((element) => ({ element, size: Number.parseFloat(getComputedStyle(element).fontSize) }))
    for (const { element, size } of sizes) element.style.fontSize = `${size * 2}px`
  })
  expect(await navigation.getByRole('link').first().evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(initialSize * 1.95)
  for (const link of await navigation.getByRole('link').all()) {
    await expect(link).toBeVisible()
    const bounds = await link.boundingBox()
    expect(bounds!.height).toBeGreaterThanOrEqual(44)
    expect(bounds!.width).toBeGreaterThanOrEqual(44)
    expect(bounds!.x).toBeGreaterThanOrEqual(-1)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(321)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await navigateWorkspace(page, 'investigation' as Workspace)
  await expect(page.locator('#workspace-heading-investigation')).toBeInViewport()
  const nav = await page.locator('.nav-frame').boundingBox()
  const heading = await page.locator('#workspace-heading-investigation').boundingBox()
  expect(heading!.y).toBeGreaterThanOrEqual(nav!.y + nav!.height - 1)
})
