import { test, expect, type Route } from '@playwright/test'
import { intelligence } from './fixtures.ts'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: intelligence }))
})

test('a delayed refresh announces busy state without hiding existing records', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  let held: Route | undefined
  await page.route('**/api/live-intel', (route) => { held = route })
  await page.getByRole('button', { name: 'Refresh sources' }).click()
  await expect.poll(() => Boolean(held)).toBe(true)
  await expect(page.locator('.live-intel-grid')).toHaveAttribute('aria-busy', 'true')
  await expect(page.locator('#intel-announcement')).toHaveText('Refreshing public intelligence sources.')
  await expect(page.getByRole('link', { name: /Open CISA record/ })).toBeVisible()
  await held!.fulfill({ json: intelligence })
  await expect(page.locator('.live-intel-grid')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('#intel-announcement')).toContainText('refresh complete')
})

test('manual refresh is disabled until the current request finishes', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  let held: Route | undefined
  let count = 0
  await page.route('**/api/live-intel', (route) => { count += 1; held = route })
  await page.getByRole('button', { name: 'Refresh sources' }).click()
  await expect(page.locator('.live-refresh')).toBeDisabled()
  await page.locator('.live-refresh').dispatchEvent('click')
  expect(count).toBe(1)
  await held!.fulfill({ json: intelligence })
  await expect(page.getByRole('button', { name: 'Refresh sources' })).toBeEnabled()
  expect(count).toBe(1)
})

test('initial network failure can recover through manual refresh', async ({ page }) => {
  await page.route('**/api/live-intel', (route) => route.abort('connectionfailed'))
  await page.goto('/')
  await expect(page.locator('.live-status-badge')).toHaveText('Source error')
  await expect(page.locator('.feed-notice')).toContainText('Could not reach')
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: intelligence }))
  await page.getByRole('button', { name: 'Refresh sources' }).click()
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  await expect(page.locator('.feed-notice')).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Open CISA record/ })).toBeVisible()
})

test('an initial total upstream outage does not invent records', async ({ page }) => {
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: {
    ...intelligence, kev: [], news: [], sources: intelligence.sources.map((source) => ({ ...source, status: 'error', count: 0 })),
  } }))
  await page.goto('/')
  await expect(page.locator('.live-status-badge')).toHaveText('Source error')
  await expect(page.locator('.osint-list a')).toHaveCount(0)
  await expect(page.locator('.empty-feed')).toHaveCount(2)
  await expect(page.locator('#intel-announcement')).toContainText('unavailable')
  await expect(page.getByRole('button', { name: 'Refresh sources' })).toBeEnabled()
})

test('healthy empty sources remain current without an outage notice', async ({ page }) => {
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: {
    ...intelligence, kev: [], news: [], sources: intelligence.sources.map((source) => ({ ...source, count: 0 })),
  } }))
  await page.goto('/')
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  await expect(page.locator('.feed-notice')).toHaveCount(0)
  await expect(page.getByText('No CISA records are available.', { exact: true })).toBeVisible()
  await expect(page.getByText('No cyber news records are available.', { exact: true })).toBeVisible()
})

test('an empty failed server snapshot cannot erase cached browser records', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: {
    ...intelligence, kev: [], news: [], sources: intelligence.sources.map((source) => ({ ...source, status: 'error', count: 0 })),
  } }))
  await page.getByRole('button', { name: 'Refresh sources' }).click()
  await expect(page.locator('.live-status-badge')).toHaveText('Stale data')
  await expect(page.getByRole('link', { name: /Open CISA record/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Open discussion record/ })).toBeVisible()
  await expect(page.locator('.source-health-panel')).toContainText('previous browser snapshot')
})
