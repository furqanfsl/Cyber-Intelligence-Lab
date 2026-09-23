import { test, expect } from '@playwright/test'
import { intelligence } from './fixtures.ts'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: intelligence }))
})

test('official advisories and community context have distinct visible provenance', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  await expect(page.locator('.osint-feed-panel h3')).toHaveText(['Exploited vulnerabilities', 'Security updates', 'Community context'])
  await expect(page.locator('.source-kind')).toHaveText(['Official government catalog', 'Official vendor advisories', 'Community reports · unverified'])
  await expect(page.locator('.community-feed')).toContainText('not independently verified')
  await expect(page.locator('.signal-strip dt').first()).toHaveText('3/3')
  await expect(page.locator('.signal-strip dd').first()).toHaveText('Connected public feeds')
  await expect(page.locator('.intel-results')).toHaveText('3 records in this snapshot')
  await expect(page.locator('.hero-brief')).toContainText(intelligence.advisories[0].title)
  await expect(page.locator('.hero-brief')).not.toContainText(intelligence.news[0].title)

  const microsoft = page.getByRole('link', { name: /Open Microsoft advisory/ })
  await expect(microsoft).toHaveAttribute('href', intelligence.advisories[0].url)
  await expect(microsoft).toHaveAttribute('target', '_blank')
  await expect(microsoft).toHaveAttribute('rel', 'noreferrer')
  await expect(microsoft).toHaveAccessibleName(/opens in a new tab/)
})

test('source validation details explain the public authentication and detection boundary', async ({ page }) => {
  await page.goto('/')
  const details = page.locator('.source-assurance')
  await details.locator('summary').focus()
  await page.keyboard.press('Enter')
  await expect(details).toHaveAttribute('open', '')
  await expect(details).toContainText('fixed HTTPS endpoints with certificate validation')
  await expect(details).toContainText('no API keys or account authentication are used')
  await expect(details).toContainText('do not independently verify every claim')
  await expect(details.getByRole('link', { name: /Microsoft source feed/ })).toHaveAttribute('href', 'https://api.msrc.microsoft.com/cvrf/v3.0/updates')
  await expect(page.locator('.data-boundary')).toContainText('does not detect attacks across the internet or monitor your devices')
  await details.locator('summary').focus()
  await page.keyboard.press('Enter')
  await expect(details).not.toHaveAttribute('open', '')
})

test('search includes official advisory identifiers and preserves all source health', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('searchbox', { name: 'Search this snapshot' }).fill('2026-sep')
  await expect(page.locator('#advisory-records a')).toHaveCount(1)
  await expect(page.locator('#kev-records a')).toHaveCount(0)
  await expect(page.locator('#news-records a')).toHaveCount(0)
  await expect(page.locator('.intel-results')).toHaveText('1 matching records')
  await expect(page.locator('.source-row')).toHaveCount(3)
  await expect(page.locator('.source-row > span')).toHaveText(['Available', 'Available', 'Available'])
  await page.getByRole('searchbox', { name: 'Search this snapshot' }).fill('not-an-advisory')
  await expect(page.locator('#advisory-records')).toHaveText('No advisories match this search.')
  await page.getByRole('button', { name: 'Clear search', exact: true }).click()
  await expect(page.locator('.osint-list a')).toHaveCount(3)
})

test('scheduled checks update official advisories without starting the simulation', async ({ page }) => {
  await page.clock.install()
  let requests = 0
  const update = { ...intelligence, advisories: [{ ...intelligence.advisories[0], title: 'Revised September 2026 Security Updates', updatedAt: '2026-09-22T11:00:00.000Z' }] }
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: ++requests === 1 ? intelligence : update }))
  await page.goto('/')
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  await page.clock.fastForward(60_100)
  await expect(page.locator('#advisory-records')).toContainText(update.advisories[0].title)
  await expect(page.locator('.hero-brief')).toContainText(update.advisories[0].title)
  await expect(page.locator('.simulation-console')).toHaveAttribute('data-state', 'ready')
  await expect(page.locator('.simulation-session-count')).toHaveText('+0')
  expect(requests).toBe(2)
})

test('Microsoft outage retains its own snapshot and reports stale independently', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: {
    ...intelligence, advisories: [], sources: [intelligence.sources[0], intelligence.sources[1], { ...intelligence.sources[2], status: 'error', count: 0, message: 'Microsoft source unavailable.' }],
  } }))
  await page.getByRole('button', { name: 'Refresh sources', exact: true }).click()
  await expect(page.locator('.live-status-badge')).toHaveText('Partial sync')
  await expect(page.locator('#advisory-records')).toContainText(intelligence.advisories[0].title)
  await expect(page.locator('.source-row > span')).toHaveText(['Available', 'stale', 'Available'])
  await expect(page.locator('.source-row').filter({ hasText: 'Microsoft Security Response Center' })).toContainText('previous browser snapshot')
  await expect(page.locator('.source-row').filter({ hasText: 'Microsoft Security Response Center' })).toContainText('Last successful refresh')
  await expect(page.locator('#kev-records a')).toHaveCount(1)
  await expect(page.locator('#news-records a')).toHaveCount(1)
})

test('mismatched official advisory links reject the snapshot without unsafe navigation', async ({ page }) => {
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: {
    ...intelligence, advisories: [{ ...intelligence.advisories[0], url: 'https://msrc.microsoft.com/update-guide/releaseNote/2026-Aug' }],
  } }))
  await page.goto('/')
  await expect(page.locator('.live-status-badge')).toHaveText('Source error')
  await expect(page.locator('.feed-notice')).toContainText('invalid data')
  await expect(page.locator('.osint-list a')).toHaveCount(0)
  await expect(page.locator('a[href$="releaseNote/2026-Aug"]')).toHaveCount(0)
})
