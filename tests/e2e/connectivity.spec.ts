import { test, expect, type Page, type Route } from '@playwright/test'
import { intelligence } from './fixtures.ts'

function refreshField(page: Page, label: string) {
  return page.locator('.automation-list > div').filter({
    has: page.locator('dt').filter({ hasText: new RegExp(`^${label}$`) }),
  }).locator('dd')
}

test('going offline retains records, pauses checks, and disables manual refresh', async ({ page, context }) => {
  await page.clock.install()
  let requests = 0
  await page.route('**/api/live-intel', (route) => {
    requests += 1
    return route.fulfill({ json: intelligence })
  })
  await page.goto('/')
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  const lastChecked = await refreshField(page, 'Last checked').textContent()

  await context.setOffline(true)
  await expect(page.locator('.live-status-badge')).toHaveText('Offline')
  await expect(page.getByRole('button', { name: 'Refresh sources' })).toBeDisabled()
  await expect(refreshField(page, 'Next check')).toHaveText('Paused while offline')
  await expect(page.locator('#intel-announcement')).toContainText('Saved intelligence records may be out of date')
  await expect(page.getByRole('link', { name: /Open CISA record/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Open discussion record/ })).toBeVisible()
  await expect(page.locator('.source-row > span')).toHaveText(['unverified', 'unverified', 'unverified'])

  await page.clock.fastForward(180_000)
  expect(requests).toBe(1)
  await expect(refreshField(page, 'Last checked')).toHaveText(lastChecked!)
  await expect(refreshField(page, 'Next check')).toHaveText('Paused while offline')
})

test('an initially offline browser waits for connectivity before its first source request', async ({ page }) => {
  // Keep the app shell reachable while modelling the browser's initial offline signal.
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }))
  let requests = 0
  await page.route('**/api/live-intel', (route) => {
    requests += 1
    return route.fulfill({ json: intelligence })
  })
  await page.goto('/')
  await expect(page.locator('.live-status-badge')).toHaveText('Offline')
  await expect(refreshField(page, 'Last checked')).toHaveText('Waiting for first check')
  await expect(refreshField(page, 'Next check')).toHaveText('Paused while offline')
  await expect(page.locator('.osint-list a')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Refresh sources' })).toBeDisabled()
  expect(requests).toBe(0)

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    window.dispatchEvent(new Event('online'))
  })
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  await expect(page.getByRole('link', { name: /Open CISA record/ })).toBeVisible()
  await expect(refreshField(page, 'Last checked')).not.toHaveText('Waiting for first check')
  expect(requests).toBe(1)
})

test('reconnecting makes one immediate check and keeps saved records visible until it finishes', async ({ page, context }) => {
  let requests = 0
  let pending: Route | undefined
  await page.route('**/api/live-intel', (route) => {
    requests += 1
    if (requests === 1) return route.fulfill({ json: intelligence })
    pending = route
  })
  await page.goto('/')
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  await context.setOffline(true)
  await expect(page.locator('.live-status-badge')).toHaveText('Offline')
  await context.setOffline(false)
  await expect.poll(() => Boolean(pending)).toBe(true)
  await expect(page.locator('.live-status-badge')).toHaveText('Refreshing')
  await expect(page.locator('.live-refresh')).toBeDisabled()
  await expect(page.locator('.live-intel-grid')).toHaveAttribute('aria-busy', 'true')
  await expect(refreshField(page, 'Next check')).toHaveText('Checking sources now')
  await expect(page.getByRole('link', { name: /Open CISA record/ })).toBeVisible()

  await page.evaluate(() => {
    window.dispatchEvent(new Event('online'))
    window.dispatchEvent(new Event('online'))
  })
  expect(requests).toBe(2)
  await pending!.fulfill({ json: intelligence })
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  await expect(page.getByRole('button', { name: 'Refresh sources' })).toBeEnabled()
  await expect(page.locator('.live-intel-grid')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('#intel-announcement')).toContainText('refresh complete')
  expect(requests).toBe(2)
})

test('a successful check advances its timestamp even when the shared snapshot is unchanged', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-22T12:05:00Z') })
  let requests = 0
  await page.route('**/api/live-intel', (route) => {
    requests += 1
    return route.fulfill({ json: intelligence })
  })
  await page.goto('/')
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  const lastChecked = await refreshField(page, 'Last checked').textContent()
  const snapshot = await refreshField(page, 'Snapshot generated').textContent()

  // Move wall time only: this must be the button's request, not an automatic poll.
  await page.clock.setSystemTime(new Date('2026-09-22T12:06:00Z'))
  await page.getByRole('button', { name: 'Refresh sources' }).click()
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  await expect(refreshField(page, 'Last checked')).not.toHaveText(lastChecked!)
  await expect(refreshField(page, 'Last checked')).toContainText(/GMT/)
  await expect(refreshField(page, 'Snapshot generated')).toHaveText(snapshot!)
  await expect(page.locator('#news-records')).toContainText(intelligence.news[0].title)
  expect(requests).toBe(2)
})

test('the countdown leads to an automatic source update without another click', async ({ page }) => {
  await page.clock.install()
  // Avoid wall-clock drift between assertions on a busy test runner.
  await page.clock.pauseAt(new Date(Date.now() + 60_000))
  let requests = 0
  const updated = {
    ...intelligence,
    generatedAt: '2026-09-22T12:01:00.000Z',
    news: [{ ...intelligence.news[0], title: 'New defensive security discussion after scheduled check' }],
  }
  await page.route('**/api/live-intel', (route) => {
    requests += 1
    return route.fulfill({ json: requests === 1 ? intelligence : updated })
  })
  await page.goto('/')
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  const firstCheck = await refreshField(page, 'Last checked').textContent()
  const firstSnapshot = await refreshField(page, 'Snapshot generated').textContent()
  await expect(page.locator('#news-records')).toContainText(intelligence.news[0].title)

  await page.clock.fastForward(30_000)
  await expect(refreshField(page, 'Next check')).toContainText(/In (29|30|31)s/)
  expect(requests).toBe(1)
  await page.clock.fastForward(30_100)
  await expect(page.locator('#news-records')).toContainText(updated.news[0].title)
  await expect(page.locator('#news-records')).not.toContainText(intelligence.news[0].title)
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  await expect(refreshField(page, 'Last checked')).not.toHaveText(firstCheck!)
  await expect(refreshField(page, 'Snapshot generated')).not.toHaveText(firstSnapshot!)
  await expect(refreshField(page, 'Next check')).toContainText(/In (59|60)s/)
  expect(requests).toBe(2)
})
