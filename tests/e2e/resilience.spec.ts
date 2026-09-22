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
