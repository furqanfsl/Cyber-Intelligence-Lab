import { expect, type Page } from '@playwright/test'

export type Workspace = 'overview' | 'endpoint' | 'investigation' | 'live-intel' | 'training' | 'cases'

const hashes: Record<Workspace, string> = {
  overview: '#overview', endpoint: '#endpoint', investigation: '#investigation',
  'live-intel': '#live-intel', training: '#operations', cases: '#cases',
}

/** Change the focused workspace through the real navigation, without remounting React. */
export async function navigateWorkspace(page: Page, workspace: Workspace) {
  await page.locator(`.nav-links a[href="${hashes[workspace]}"]`).click()
  await expect(page.locator(`.workspace-view[data-workspace="${workspace}"]`)).toBeVisible()
  await expect(page.locator('.workspace-view:visible')).toHaveCount(1)
}

/** Feed/training boundary checks deliberately leave and return to their original view. */
export async function inspectPublicFeeds<T>(page: Page, inspect: () => Promise<T>): Promise<T> {
  const previous = await page.locator('.workspace-view:visible').getAttribute('data-workspace') as Workspace
  if (previous !== 'live-intel') await navigateWorkspace(page, 'live-intel')
  try { return await inspect() }
  finally { if (previous !== 'live-intel') await navigateWorkspace(page, previous) }
}
