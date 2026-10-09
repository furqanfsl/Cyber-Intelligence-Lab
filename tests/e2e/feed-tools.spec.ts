import { test, expect } from '@playwright/test'
import { intelligence } from './fixtures.ts'
import { feedSources, openSourceDetails, selectFeed } from './feed-helpers.ts'
import { navigateWorkspace } from './workspace-helpers.ts'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: intelligence }))
})

test('snapshot search filters every source without changing health or the selected feed', async ({ page }) => {
  await page.goto('/#live-intel')
  const search = page.getByRole('searchbox', { name: 'Search this snapshot' })
  await search.fill('  cve-2026-12345  ')
  await expect(page.locator('#kev-records a')).toHaveCount(1)
  await expect(page.locator('#news-records')).toHaveCount(0)
  await expect(page.locator('.intel-results')).toHaveText('1 matching record across all sources')
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  await search.fill('not-in-the-snapshot')
  await expect(page.locator('#kev-records')).toHaveText('No vulnerabilities match this search.')
  await selectFeed(page, 'news')
  await expect(page.locator('#news-records')).toHaveText('No discussions match this search.')
  await selectFeed(page, 'advisory')
  await expect(page.locator('#advisory-records')).toHaveText('No advisories match this search.')
  await page.getByRole('button', { name: 'Clear search' }).click()
  await expect(search).toHaveValue('')
  await expect(page.locator('.osint-list a')).toHaveCount(1)
  await openSourceDetails(page)
  await expect(page.locator('.source-row > span')).toHaveText(['Available', 'Available', 'Available'])
  for (const source of feedSources) {
    await selectFeed(page, source.key)
    await expect(page.locator(`#${source.records} a`)).toHaveCount(1)
  }
})

test('expanded feed reveals all available records and restores compact mode', async ({ page }) => {
  const kev = Array.from({ length: 8 }, (_, index) => ({ ...intelligence.kev[0],
    id: `CVE-2026-${12345 + index}`,
    url: `https://www.cisa.gov/known-exploited-vulnerabilities-catalog?search_api_fulltext=CVE-2026-${12345 + index}`,
  }))
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: {
    ...intelligence, kev, sources: [{ ...intelligence.sources[0], count: 8 }, intelligence.sources[1], intelligence.sources[2]],
  } }))
  await page.goto('/#live-intel')
  await expect(page.locator('#kev-records a')).toHaveCount(5)
  const expand = page.getByRole('button', { name: 'Show all records', exact: true })
  await expand.click()
  await expect(page.locator('#kev-records a')).toHaveCount(8)
  const collapse = page.getByRole('button', { name: 'Show latest 5', exact: true })
  await expect(collapse).toHaveAttribute('aria-expanded', 'true')
  await collapse.click()
  await expect(page.locator('#kev-records a')).toHaveCount(5)
})

test('simulation counters stay coherent and pause without changing live records', async ({ page }) => {
  await page.clock.install()
  await page.goto('/#live-intel')
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  const records = await page.locator('#kev-records a').allTextContents()
  await navigateWorkspace(page, 'training')
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
  await navigateWorkspace(page, 'live-intel')
  expect(await page.locator('#kev-records a').allTextContents()).toEqual(records)
})

test('self-hosted fonts load and active navigation reflects the current section', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => document.fonts.ready)
  expect(await page.evaluate(() => document.fonts.check('600 16px Manrope') && document.fonts.check('400 12px "IBM Plex Mono"'))).toBe(true)
  await page.locator('.nav-links a[href="#operations"]').click()
  await expect(page.locator('.nav-links a[href="#operations"]')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.nav-links a[aria-current]')).toHaveCount(1)
  expect(await page.locator('body').innerText()).not.toContain('\uFFFD')
})
