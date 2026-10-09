import { test, expect } from '@playwright/test'
import { intelligence } from './fixtures.ts'
import { feedSources, openSourceDetails, selectFeed } from './feed-helpers.ts'

function snapshot(kevCount = 8, newsCount = 12, advisoryCount = 8) {
  return {
    ...intelligence,
    sources: [{ ...intelligence.sources[0], count: kevCount }, { ...intelligence.sources[1], count: newsCount }, { ...intelligence.sources[2], count: advisoryCount }],
    kev: Array.from({ length: kevCount }, (_, index) => ({
      ...intelligence.kev[0], id: `CVE-2026-${12345 + index}`,
      title: index % 2 ? 'A short advisory' : 'A longer exploited vulnerability advisory across multiple enterprise software components',
      url: `https://www.cisa.gov/known-exploited-vulnerabilities-catalog?search_api_fulltext=CVE-2026-${12345 + index}`,
    })),
    news: Array.from({ length: newsCount }, (_, index) => ({
      ...intelligence.news[0], id: String(12345678 + index), title: `Security discussion ${index + 1}`,
      url: `https://news.ycombinator.com/item?id=${12345678 + index}`,
    })),
    advisories: Array.from({ length: advisoryCount }, (_, index) => ({
      ...intelligence.advisories[0], id: `${2026 - index}-Sep`, title: `September ${2026 - index} Security Updates`,
      url: `https://msrc.microsoft.com/update-guide/releaseNote/${2026 - index}-Sep`,
    })),
  }
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: snapshot() }))
})

test('each source uses one full-width panel without reintroducing side-by-side feeds', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await expect(page.locator('#kev-records a')).toHaveCount(5)
  const workspace = (await page.locator('.live-intel-grid').boundingBox())!
  for (const source of feedSources) {
    await selectFeed(page, source.key)
    await expect(page.locator('.osint-feed-panel:visible')).toHaveCount(1)
    const panel = (await page.locator('.osint-feed-panel:visible').boundingBox())!
    expect(Math.abs(panel.x - workspace.x)).toBeLessThan(1)
    expect(Math.abs(panel.width - workspace.width)).toBeLessThan(1)
    await expect(page.locator(`#${source.records} a`)).toHaveCount(5)
    const footer = (await page.locator('.feed-footer').boundingBox())!
    const records = (await page.locator(`#${source.records}`).boundingBox())!
    expect(footer.y).toBeGreaterThanOrEqual(records.y + records.height - 1)
    expect(footer.y + footer.height).toBeLessThanOrEqual(panel.y + panel.height)
  }
})

test('source counts distinguish snapshot matches from the selected feed displayed count', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  await expect(page.locator('.intel-results')).toHaveText('28 records in this snapshot')
  await expect(page.locator('#kev-feed-tab')).toHaveAccessibleDescription('8 records')
  await expect(page.locator('#advisory-feed-tab')).toHaveAccessibleDescription('8 records')
  await expect(page.locator('#news-feed-tab')).toHaveAccessibleDescription('12 records')
  await expect(page.locator('.osint-feed-panel:visible .panel-heading data')).toHaveAttribute('value', '5')
  await expect(page.locator('.feed-footer')).toContainText('5 of 8 records')
  await page.getByRole('button', { name: 'Show all records', exact: true }).click()
  await expect(page.locator('.osint-feed-panel:visible .panel-heading data')).toHaveAttribute('value', '8')
  await expect(page.locator('.feed-footer')).toContainText('8 of 8 records')
  await selectFeed(page, 'news')
  await expect(page.locator('.osint-feed-panel:visible .panel-heading data')).toHaveAttribute('value', '5')
  await expect(page.locator('.feed-footer')).toContainText('5 of 12 records')
  await page.getByRole('searchbox', { name: 'Search this snapshot' }).fill('security')
  await expect(page.locator('.intel-results')).toHaveText('20 matching records across all sources')
  await expect(page.locator('#kev-feed-tab')).toHaveAccessibleDescription('0 matching records')
  await expect(page.locator('#advisory-feed-tab')).toHaveAccessibleDescription('8 matching records')
  await expect(page.locator('#news-feed-tab')).toHaveAccessibleDescription('12 matching records')
  await expect(page.locator('#news-feed-tab')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.osint-feed-panel:visible .panel-heading data')).toHaveAttribute('value', '12')
  await expect(page.locator('.feed-footer')).toContainText('12 of 12 matching records')
})

test('every active source header and record stays inside its frame at desktop widths', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#kev-records a')).toHaveCount(5)
  for (const width of [1101, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const source of feedSources) {
      await selectFeed(page, source.key)
      const panel = (await page.locator('.osint-feed-panel:visible').boundingBox())!
      for (const element of await page.locator('.osint-feed-panel:visible').locator('.panel-heading h3, .osint-list a, .feed-footer').all()) {
        const bounds = (await element.boundingBox())!
        expect(bounds.x).toBeGreaterThanOrEqual(panel.x)
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(panel.x + panel.width + 1)
      }
      await expect(page.locator('.osint-feed-panel:visible h3')).toHaveText(source.title)
    }
  }
})

test('the refresh strip scrolls normally and cannot overlap source health', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  const strip = page.locator('.live-status-panel')
  await expect(strip).toHaveCSS('position', 'relative')
  await strip.scrollIntoViewIfNeeded()
  const before = (await strip.boundingBox())!
  await page.evaluate(() => window.scrollBy(0, 180))
  const after = (await strip.boundingBox())!
  expect(Math.abs(before.y - after.y - 180)).toBeLessThan(2)
  await expect(page.locator('#source-diagnostics')).not.toHaveAttribute('open')
  await openSourceDetails(page)
  await page.locator('.source-health-panel').scrollIntoViewIfNeeded()
  const status = (await strip.boundingBox())!
  const health = (await page.locator('.source-health-panel').boundingBox())!
  const feeds = await page.locator('.osint-feed-panel:visible').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().bottom))
  expect(status.y + status.height).toBeLessThan(health.y)
  expect(Math.max(...feeds)).toBeLessThan(health.y)
  expect(await page.locator('.source-health-panel').evaluate((node) => node.parentElement?.classList.contains('live-intel-grid'))).toBe(false)
})

test('expansion is independent per source and the selected long snapshot is keyboard browsable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Show all records', exact: true }).click()
  await expect(page.locator('#kev-records a')).toHaveCount(8)
  await selectFeed(page, 'news')
  await expect(page.locator('#news-records a')).toHaveCount(5)
  await page.getByRole('button', { name: 'Show all records', exact: true }).click()
  await expect(page.locator('#news-records a')).toHaveCount(12)
  await selectFeed(page, 'advisory')
  await expect(page.locator('#advisory-records a')).toHaveCount(5)
  await page.getByRole('button', { name: 'Show all records', exact: true }).click()
  await expect(page.locator('#advisory-records a')).toHaveCount(8)
  await selectFeed(page, 'news')
  await expect(page.locator('#news-records a')).toHaveCount(12)
  const region = page.getByRole('region', { name: 'Cyber news records', exact: true })
  await region.focus()
  await expect(region).toBeFocused()
  await page.keyboard.press('PageDown')
  await expect.poll(() => region.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
  await page.locator('#news-records a').last().focus()
  await expect(page.locator('#news-records a').last()).toBeFocused()
  await page.getByRole('button', { name: 'Show latest 5', exact: true }).click()
  await expect(region).not.toHaveAttribute('tabindex', '0')
  await expect(page.locator('#news-records a')).toHaveCount(5)
  await selectFeed(page, 'kev')
  await expect(page.locator('#kev-records a')).toHaveCount(8)
})

test('tablet and mobile source tabs and selected records fit without nested scroll areas', async ({ page }) => {
  await page.goto('/')
  for (const width of [1100, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    for (const source of feedSources) {
      await selectFeed(page, source.key)
      const expand = page.getByRole('button', { name: 'Show all records', exact: true })
      if (await expand.count()) await expand.click()
      const region = page.locator(`#${source.records}`)
      expect(await region.evaluate((node) => node.scrollHeight <= node.clientHeight + 1)).toBe(true)
      await expect(page.locator('.osint-feed-panel:visible')).toHaveCount(1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    const tablist = (await page.getByRole('tablist', { name: 'Intelligence sources' }).boundingBox())!
    for (const tab of await page.getByRole('tablist', { name: 'Intelligence sources' }).getByRole('tab').all()) {
      const bounds = (await tab.boundingBox())!
      expect(bounds.height).toBeGreaterThanOrEqual(44)
      expect(bounds.x).toBeGreaterThanOrEqual(tablist.x - 1)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(tablist.x + tablist.width + 1)
    }
  }
})

test('empty search results do not leave oversized feed bodies', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Show all records', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search this snapshot' }).fill('NoMatchingRecordInThisSnapshot')
  await expect(page.locator('.intel-results')).toHaveText('0 matching records across all sources')
  for (const source of feedSources) {
    await selectFeed(page, source.key)
    const bounds = (await page.locator('.osint-feed-panel:visible').boundingBox())!
    expect(bounds.height).toBeLessThan(400)
    await expect(page.locator(`#${source.records} a`)).toHaveCount(0)
  }
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
})
