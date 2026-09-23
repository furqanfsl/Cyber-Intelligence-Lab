import { test, expect } from '@playwright/test'
import { intelligence } from './fixtures.ts'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: intelligence }))
})

test('snapshot search filters records without hiding source health and clears cleanly', async ({ page }) => {
  await page.goto('/')
  const search = page.getByRole('searchbox', { name: 'Search this snapshot' })
  await search.fill('  cve-2026-12345  ')
  await expect(page.locator('#kev-records a')).toHaveCount(1)
  await expect(page.locator('#news-records a')).toHaveCount(0)
  await expect(page.locator('.intel-results')).toHaveText('1 matching records')
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  await search.fill('not-in-the-snapshot')
  await expect(page.locator('#kev-records')).toHaveText('No vulnerabilities match this search.')
  await expect(page.locator('#news-records')).toHaveText('No discussions match this search.')
  await page.getByRole('button', { name: 'Clear search' }).click()
  await expect(search).toHaveValue('')
  await expect(page.locator('.osint-list a')).toHaveCount(3)
})

test('expanded feed reveals all available records and restores compact mode', async ({ page }) => {
  const kev = Array.from({ length: 8 }, (_, index) => ({ ...intelligence.kev[0],
    id: `CVE-2026-${12345 + index}`,
    url: `https://www.cisa.gov/known-exploited-vulnerabilities-catalog?search_api_fulltext=CVE-2026-${12345 + index}`,
  }))
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: {
    ...intelligence, kev, sources: [{ ...intelligence.sources[0], count: 8 }, intelligence.sources[1], intelligence.sources[2]],
  } }))
  await page.goto('/')
  await expect(page.locator('#kev-records a')).toHaveCount(5)
  const expand = page.getByRole('button', { name: 'Show all records', exact: true })
  await expand.click()
  await expect(page.locator('#kev-records a')).toHaveCount(8)
  const collapse = page.getByRole('button', { name: 'Show latest 5 per feed', exact: true })
  await expect(collapse).toHaveAttribute('aria-expanded', 'true')
  await collapse.click()
  await expect(page.locator('#kev-records a')).toHaveCount(5)
})

test('simulation counters stay coherent and pause without changing live records', async ({ page }) => {
  await page.clock.install()
  await page.goto('/')
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  const total = page.locator('.map-panel .map-readout data')
  await expect(total).toHaveText('9,503')
  await page.getByRole('button', { name: 'Start simulation', exact: true }).click()
  await expect(total).toHaveText('9,510')
  await page.clock.fastForward(2600)
  await expect(total).toHaveText('9,517')
  const sum = await page.locator('.map-panel .map-node data').evaluateAll((nodes) => nodes.reduce((value, node) => value + Number(node.textContent!.replaceAll(',', '')), 0))
  expect(sum).toBe(9517)
  await page.getByRole('button', { name: 'Pause simulation', exact: true }).click()
  await page.clock.fastForward(5200)
  await expect(total).toHaveText('9,517')
  await expect(page.locator('.signal-strip dt').nth(1)).toHaveText('3')
})

test('self-hosted fonts load and active navigation reflects the current section', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => document.fonts.ready)
  expect(await page.evaluate(() => document.fonts.check('600 16px Manrope') && document.fonts.check('400 12px "IBM Plex Mono"'))).toBe(true)
  await page.locator('.nav-links a[href="#response"]').click()
  await expect(page.locator('.nav-links a[href="#response"]')).toHaveAttribute('aria-current', 'location')
  await expect(page.locator('.nav-links a[aria-current]')).toHaveCount(1)
  expect(await page.locator('body').innerText()).not.toContain('\uFFFD')
})
