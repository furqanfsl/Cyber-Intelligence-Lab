import { test, expect } from '@playwright/test'
import { intelligence } from './fixtures.ts'

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

test('all three feeds have matching edges despite different text lengths', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await expect(page.locator('#kev-records a')).toHaveCount(5)
  const panels = await page.locator('.osint-feed-panel').all()
  expect(panels).toHaveLength(3)
  const a = (await panels[0].boundingBox())!
  for (const panel of panels.slice(1)) {
    const b = (await panel.boundingBox())!
    expect(Math.abs(a.y - b.y)).toBeLessThan(1)
    expect(Math.abs(a.height - b.height)).toBeLessThan(1)
    expect(Math.abs(a.width - b.width)).toBeLessThan(1)
  }
  const footers = await page.locator('.feed-footer').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top))
  for (const footer of footers.slice(1)) expect(Math.abs(footers[0] - footer)).toBeLessThan(1)
})

test('three feed headers and record rows align at desktop widths', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#kev-records a')).toHaveCount(5)
  for (const width of [1101, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    const rows = await page.locator('.osint-list').evaluateAll((lists) => lists.map((list) =>
      [...list.querySelectorAll('a')].map((node) => node.getBoundingClientRect().top)))
    for (const row of rows.slice(1)) rows[0].forEach((top, index) => expect(Math.abs(top - row[index])).toBeLessThan(2))
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
  await page.locator('.source-health-panel').scrollIntoViewIfNeeded()
  const status = (await strip.boundingBox())!
  const health = (await page.locator('.source-health-panel').boundingBox())!
  const feeds = await page.locator('.osint-feed-panel').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().bottom))
  expect(status.y + status.height).toBeLessThan(health.y)
  expect(Math.max(...feeds)).toBeLessThan(health.y)
  expect(await page.locator('.source-health-panel').evaluate((node) => node.parentElement?.classList.contains('live-intel-grid'))).toBe(false)
})

test('expanded unequal snapshots stay aligned and remain keyboard browsable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Show all records', exact: true }).click()
  await expect(page.locator('#kev-records a')).toHaveCount(8)
  await expect(page.locator('#news-records a')).toHaveCount(12)
  await expect(page.locator('#advisory-records a')).toHaveCount(8)
  const panels = await page.locator('.osint-feed-panel').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))
  for (const height of panels.slice(1)) expect(Math.abs(panels[0] - height)).toBeLessThan(1)
  const region = page.getByRole('region', { name: 'Cyber news records', exact: true })
  await region.focus()
  await expect(region).toBeFocused()
  await page.keyboard.press('PageDown')
  await expect.poll(() => region.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
  await page.locator('#news-records a').last().focus()
  await expect(page.locator('#news-records a').last()).toBeFocused()
  await page.getByRole('button', { name: 'Show latest 5 per feed', exact: true }).click()
  await expect(region).not.toHaveAttribute('tabindex', '0')
})

test('tablet and mobile feeds stack naturally without nested scroll areas or overflow', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Show all records', exact: true }).click()
  for (const width of [1100, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    for (const selector of ['#kev-records', '#advisory-records', '#news-records']) {
      const region = page.locator(selector)
      expect(await region.evaluate((node) => node.scrollHeight <= node.clientHeight + 1)).toBe(true)
    }
    const panels = await page.locator('.osint-feed-panel').evaluateAll((nodes) => nodes.map((node) => ({ y: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom })))
    for (let index = 1; index < panels.length; index++) expect(panels[index].y).toBeGreaterThan(panels[index - 1].bottom)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

test('empty search results do not leave oversized feed bodies', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Show all records', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search this snapshot' }).fill('NoMatchingRecordInThisSnapshot')
  await expect(page.locator('.intel-results')).toHaveText('0 matching records')
  const bounds = (await page.locator('.osint-feed-panel').first().boundingBox())!
  expect(bounds.height).toBeLessThan(400)
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
})
