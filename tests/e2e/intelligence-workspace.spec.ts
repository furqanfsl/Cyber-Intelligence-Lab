import { expect, test } from '@playwright/test'
import { intelligence } from './fixtures.ts'
import { feedSources, openSourceDetails, selectFeed } from './feed-helpers.ts'
import { navigateWorkspace } from './workspace-helpers.ts'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: intelligence }))
})

test('intelligence opens with CISA only and each source tab controls its correctly labelled panel', async ({ page }) => {
  await page.goto('/#live-intel')
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  const tablist = page.getByRole('tablist', { name: 'Intelligence sources' })
  await expect(tablist.getByRole('tab')).toHaveCount(3)
  await expect(tablist.getByRole('tab', { name: 'CISA', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#live-intel').getByRole('tabpanel')).toHaveCount(1)
  await expect(page.locator('#advisory-records, #news-records')).toHaveCount(0)
  for (const source of feedSources) {
    await selectFeed(page, source.key)
    const tab = tablist.getByRole('tab', { name: source.name, exact: true })
    await expect(tab).toHaveAttribute('aria-controls', `${source.key}-feed-panel`)
    await expect(tab).toHaveAttribute('id', `${source.key}-feed-tab`)
    await expect(tab).toHaveAccessibleDescription('1 record')
    await expect(page.locator(`#${source.key}-feed-panel`)).toHaveAttribute('aria-labelledby', `${source.key}-feed-tab`)
    await expect(page.locator('.osint-feed-panel:visible')).toHaveCount(1)
    await expect(page.locator('.osint-feed-panel:visible h3')).toHaveText(source.title)
    await expect(page.locator(`#${source.records} a`)).toHaveCount(1)
    for (const other of feedSources.filter((item) => item.key !== source.key)) {
      await expect(page.locator(`#${other.key}-feed-panel`)).toBeHidden()
      await expect(page.locator(`#${other.key}-feed-panel`)).toHaveAttribute('tabindex', '-1')
      await expect(page.locator(`#${other.records}`)).toHaveCount(0)
    }
  }
})

test('source tabs automatically activate with arrows, Home and End while keeping one tab stop', async ({ page }) => {
  await page.goto('/#live-intel')
  const tablist = page.getByRole('tablist', { name: 'Intelligence sources' })
  const cisa = tablist.getByRole('tab', { name: 'CISA', exact: true })
  await cisa.focus()
  for (const [key, name, id] of [
    ['ArrowRight', 'Microsoft', 'advisory'],
    ['ArrowRight', 'Community', 'news'],
    ['ArrowRight', 'CISA', 'kev'],
    ['ArrowLeft', 'Community', 'news'],
    ['Home', 'CISA', 'kev'],
    ['End', 'Community', 'news'],
  ] as const) {
    await page.keyboard.press(key)
    const selected = tablist.getByRole('tab', { name, exact: true })
    await expect(selected).toBeFocused()
    await expect(selected).toHaveAttribute('aria-selected', 'true')
    await expect(tablist.locator('[role="tab"][tabindex="0"]')).toHaveCount(1)
    await expect(tablist.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1)
    await expect(page.locator('#live-intel').getByRole('tabpanel')).toHaveAttribute('id', `${id}-feed-panel`)
  }
  await page.keyboard.press('Tab')
  await expect(page.locator('#news-feed-panel')).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(page.locator('#news-feed-panel')).toBeFocused()
  await expect(tablist.getByRole('tab', { name: 'Community', exact: true })).toHaveAttribute('aria-selected', 'true')
})

test('global search exposes per-source matches without auto-switching the selected feed or losing provenance', async ({ page }) => {
  await page.goto('/#live-intel')
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  const search = page.getByRole('searchbox', { name: 'Search this snapshot' })
  await search.fill('example-author')
  await expect(page.locator('.intel-results')).toHaveText('1 matching record across all sources')
  await expect(page.locator('#kev-feed-tab')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#kev-records')).toContainText('No vulnerabilities match this search.')
  await expect(page.locator('#kev-records')).toContainText('1 matching record is available in the other source tabs.')
  await expect(page.locator('#kev-feed-tab')).toHaveAccessibleDescription('0 matching records')
  await expect(page.locator('#advisory-feed-tab')).toHaveAccessibleDescription('0 matching records')
  await expect(page.locator('#news-feed-tab')).toHaveAccessibleDescription('1 matching record')
  await selectFeed(page, 'news')
  await expect(page.locator('#news-records a')).toHaveCount(1)
  await expect(page.locator('.community-feed')).toContainText('not independently verified')
  await expect(page.locator('.feed-footer')).toContainText('1 of 1 matching record')
  await openSourceDetails(page)
  await expect(page.locator('.source-row')).toHaveCount(3)
  await expect(page.locator('.source-row > span')).toHaveText(['Available', 'Available', 'Available'])
  await expect(page.locator('.source-kind')).toHaveText(['Official government catalog', 'Official vendor advisories', 'Community reports · unverified'])
  await page.getByRole('button', { name: 'Clear search', exact: true }).click()
  await expect(search).toHaveValue('')
  await expect(page.locator('#news-feed-tab')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.intel-results')).toHaveText('3 records in this snapshot')
  for (const source of feedSources) await expect(page.locator(`#${source.key}-feed-tab`)).toHaveAccessibleDescription('1 record')
})

test('source diagnostics start folded, open by keyboard, and retain timing, health and validation controls', async ({ page }) => {
  await page.goto('/#live-intel')
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  const details = page.locator('#source-diagnostics')
  const summary = details.locator(':scope > summary')
  await expect(details).not.toHaveAttribute('open')
  await expect(page.locator('.automation-list')).toBeHidden()
  await expect(page.locator('.source-health-panel')).toBeHidden()
  await expect(page.locator('.source-assurance')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Refresh sources', exact: true })).toBeVisible()
  await summary.focus()
  await page.keyboard.press('Enter')
  await expect(details).toHaveAttribute('open', '')
  await expect(page.locator('.automation-list dt')).toHaveText(['Next check', 'Last checked', 'Snapshot generated', 'Healthy sources'])
  await expect(page.locator('.source-row')).toHaveCount(3)
  await expect(page.locator('.source-health-panel')).toBeVisible()
  await expect(page.locator('.source-assurance')).not.toHaveAttribute('open')
  await page.locator('.source-assurance > summary').click()
  await expect(page.locator('.source-assurance')).toHaveAttribute('open', '')
  await expect(page.getByRole('link', { name: /Microsoft source feed/ })).toBeVisible()
  await summary.focus()
  await page.keyboard.press('Enter')
  await expect(details).not.toHaveAttribute('open')
  await expect(page.locator('.source-health-panel')).toBeHidden()
})

test('changing source, searching and disclosing diagnostics never issues another fetch or starts simulation', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-07T12:00:00Z') })
  let requests = 0
  await page.route('**/api/live-intel', (route) => { requests++; return route.fulfill({ json: intelligence }) })
  await page.goto('/#live-intel')
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  for (const source of [...feedSources, ...feedSources]) await selectFeed(page, source.key)
  await page.getByRole('searchbox', { name: 'Search this snapshot' }).fill('example')
  await openSourceDetails(page)
  await expect(page.locator('.source-row')).toHaveCount(3)
  await page.getByRole('button', { name: 'Clear search', exact: true }).click()
  expect(requests).toBe(1)
  await navigateWorkspace(page, 'training')
  await expect(page.locator('.simulation-console')).toHaveAttribute('data-state', 'ready')
  await expect(page.locator('.simulation-session-count')).toHaveText('+0')
})

test('the dashboard ends without the removed skills section or a dead skills navigation target', async ({ page }) => {
  await page.goto('/#live-intel')
  await expect(page.locator('#skills, .skills-grid')).toHaveCount(0)
  await expect(page.locator('.nav-links a')).toHaveCount(6)
  await expect(page.locator('a[href="#skills"]')).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Back to top/ })).toHaveAttribute('href', '#live-intel')
  await page.getByRole('link', { name: /Back to top/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toBeInViewport()
})
