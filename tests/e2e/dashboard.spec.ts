import { test, expect } from '@playwright/test'
import { intelligence } from './fixtures.ts'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: intelligence }))
})

test('renders without errors or horizontal overflow', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cyber Intelligence Lab')
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(errors).toEqual([])
  const missingAnchors = await page.locator('a[href^="#"]').evaluateAll((links) => links
    .map((link) => link.getAttribute('href')!)
    .filter((href) => href.length > 1 && !document.getElementById(href.slice(1))))
  expect(missingAnchors).toEqual([])
})

test('skip link moves keyboard focus to main content', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#main-content')).toBeFocused()
})

test('severity filtering keeps selection and details consistent', async ({ page }) => {
  await page.goto('/')
  const rows = page.locator('.queue-row')
  await expect(rows).toHaveCount(5)
  await page.locator('.severity-filter').getByRole('button', { name: 'high', exact: true }).click()
  await expect(rows).toHaveCount(2)
  await expect(rows.first()).toHaveAttribute('aria-pressed', 'true')
  await rows.last().click()
  await expect(rows.last()).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.alert-panel h3')).toHaveText((await rows.last().locator('strong').textContent())!)
  await page.locator('.severity-filter').getByRole('button', { name: 'all', exact: true }).click()
  await expect(rows).toHaveCount(5)
})

test('forensic tabs support arrow, Home and End keys', async ({ page }) => {
  await page.goto('/')
  const file = page.getByRole('tab', { name: 'File', exact: true })
  await file.click()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Network', exact: true })).toBeFocused()
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'artifact-tab-network')
  await page.keyboard.press('End')
  await expect(page.getByRole('tab', { name: 'Registry', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Home')
  await expect(file).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('tab', { name: 'Registry', exact: true })).toBeFocused()
})

test('copy brief reports success only after clipboard write', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text: string) => { document.documentElement.dataset.copiedBrief = text },
    } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Copy brief', exact: true }).click()
  await expect(page.locator('.copy-feedback')).toHaveText('Demo brief copied to clipboard.')
  expect(await page.evaluate(() => document.documentElement.dataset.copiedBrief)).toContain('SIMULATED INCIDENT')
})

test('clipboard denial has an honest recovery message', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async () => { throw new Error('Permission denied') },
    } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Copy brief', exact: true }).click()
  await expect(page.locator('.copy-feedback')).toContainText('Clipboard access is unavailable')
  await expect(page.getByRole('button', { name: 'Brief copied', exact: true })).toHaveCount(0)
})

test('simulation is opt-in and can be paused', async ({ page }) => {
  await page.goto('/')
  const start = page.getByRole('button', { name: 'Start simulation', exact: true })
  await expect(start).toHaveAttribute('aria-pressed', 'false')
  await start.click()
  const pause = page.getByRole('button', { name: 'Pause simulation', exact: true })
  await expect(pause).toHaveAttribute('aria-pressed', 'true')
  await pause.click()
  await expect(start).toHaveAttribute('aria-pressed', 'false')
})

test('public source links use stable records and new-tab descriptions', async ({ page }) => {
  await page.goto('/')
  const cisa = page.getByRole('link', { name: /Open CISA record/ })
  await expect(cisa).toHaveAttribute('href', intelligence.kev[0].url)
  await expect(cisa).toHaveAttribute('target', '_blank')
  await expect(cisa).toHaveAttribute('rel', 'noreferrer')
  await expect(page.getByRole('link', { name: /Open discussion record/ })).toHaveAttribute('href', intelligence.news[0].url)
})

test('failed refresh retains the last good records with a stale label', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  await page.route('**/api/live-intel', (route) => route.fulfill({ status: 503, json: { error: 'Unavailable' } }))
  await page.getByRole('button', { name: 'Refresh sources' }).click()
  await expect(page.locator('.live-status-badge')).toHaveText('Stale data')
  await expect(page.getByRole('link', { name: /Open CISA record/ })).toBeVisible()
  await expect(page.locator('.feed-notice')).toContainText('Automatic retry')
})

test('malformed initial response is rejected without rendering unsafe links', async ({ page }) => {
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: { ...intelligence, kev: [{ ...intelligence.kev[0], url: 'javascript:alert(1)' }] } }))
  await page.goto('/')
  await expect(page.locator('.live-status-badge')).toHaveText('Source error')
  await expect(page.locator('.feed-notice')).toContainText('invalid data')
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0)
})

test('partial provider failures are not reported as current', async ({ page }) => {
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: {
    ...intelligence, news: [], sources: [intelligence.sources[0], { ...intelligence.sources[1], status: 'error', count: 0, message: 'News source unavailable.' }],
  } }))
  await page.goto('/')
  await expect(page.locator('.live-status-badge')).toHaveText('Partial sync')
  await expect(page.locator('.feed-notice')).toContainText('Some sources could not refresh')
  await expect(page.getByText('News source unavailable.', { exact: true })).toBeVisible()
})

test('long public-source titles wrap inside cards', async ({ page }) => {
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: {
    ...intelligence, news: [{ ...intelligence.news[0], title: 'UnbrokenExternalTitle'.repeat(35) }],
  } }))
  await page.goto('/')
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('available fresh news remains partial when no aggregate source is fully healthy', async ({ page }) => {
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: {
    ...intelligence, kev: [], sources: [
      { ...intelligence.sources[0], status: 'error', count: 0 },
      { ...intelligence.sources[1], status: 'error', count: 1, message: 'One search failed; showing available results.' },
    ],
  } }))
  await page.goto('/')
  await expect(page.locator('.live-status-badge')).toHaveText('Partial sync')
  await expect(page.getByRole('link', { name: /Open discussion record/ })).toBeVisible()
})

test('a healthy empty feed is not labelled unavailable when the other source fails', async ({ page }) => {
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: {
    ...intelligence, kev: [], news: [], sources: [
      { ...intelligence.sources[0], status: 'error', count: 0 },
      { ...intelligence.sources[1], status: 'ok', count: 0 },
    ],
  } }))
  await page.goto('/')
  await expect(page.locator('.live-status-badge')).toHaveText('Partial sync')
  await expect(page.getByText('No cyber news records are available.', { exact: true })).toBeVisible()
  await expect(page.getByText('CISA is unavailable. Try refreshing or wait for the next check.', { exact: true })).toBeVisible()
})
