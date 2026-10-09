import { expect, type Page } from '@playwright/test'

export const feedSources = [
  { key: 'kev', name: 'CISA', title: 'Exploited vulnerabilities', records: 'kev-records' },
  { key: 'advisory', name: 'Microsoft', title: 'Security updates', records: 'advisory-records' },
  { key: 'news', name: 'Community', title: 'Community context', records: 'news-records' },
] as const

export type FeedSource = typeof feedSources[number]['key']

/** Activate a real source control; inactive feeds must not leak visible records. */
export async function selectFeed(page: Page, key: FeedSource) {
  const source = feedSources.find((item) => item.key === key)!
  const tablist = page.getByRole('tablist', { name: 'Intelligence sources' })
  const tab = tablist.getByRole('tab', { name: source.name, exact: true })
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator(`#${key}-feed-panel`)).toBeVisible()
  await expect(page.locator(`#${key}-feed-panel`)).toHaveAttribute('tabindex', '0')
  await expect(page.locator('#live-intel').getByRole('tabpanel')).toHaveCount(1)
  await expect(page.locator(`#${source.records}`)).toBeVisible()
  return source
}

/** Tests inspect diagnostics through its disclosed UI, not hidden DOM text. */
export async function openSourceDetails(page: Page) {
  const details = page.locator('#source-diagnostics')
  if (await details.getAttribute('open') === null) await details.locator('summary').first().click()
  await expect(details).toHaveAttribute('open', '')
  return details
}

/** Keep the original three-source preservation checks meaningful with tabbed rendering. */
export async function readAllFeedRecords(page: Page) {
  const selectedId = await page.getByRole('tablist', { name: 'Intelligence sources' })
    .locator('[aria-selected="true"]').getAttribute('id')
  const snapshots: Record<string, string[]> = {}
  for (const source of feedSources) {
    await selectFeed(page, source.key)
    snapshots[source.key] = await page.locator(`#${source.records} a`).allTextContents()
  }
  const initial = feedSources.find((source) => selectedId === `${source.key}-feed-tab`)!
  await selectFeed(page, initial.key)
  return snapshots
}
