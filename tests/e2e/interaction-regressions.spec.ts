import { test, expect } from '@playwright/test'
import { intelligence } from './fixtures.ts'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: intelligence }))
})

test('each severity keeps selected alert and triage context aligned', async ({ page }) => {
  await page.goto('/')
  for (const [severity, count] of [['critical', 1], ['high', 2], ['medium', 1], ['low', 1]] as const) {
    await page.locator('.severity-filter').getByRole('button', { name: severity, exact: true }).click()
    await expect(page.locator('.queue-row')).toHaveCount(count)
    await expect(page.locator('.queue-row[aria-pressed="true"]')).toHaveCount(1)
    const selected = (await page.locator('.queue-row[aria-pressed="true"] strong').textContent())!
    await expect(page.locator('.alert-panel h3')).toHaveText(selected)
    await expect(page.locator('.risk-grid').locator('strong').nth(1)).toHaveText(selected)
    await expect(page.locator('.alert-panel .severity-badge')).toHaveText(severity.toUpperCase())
  }
})
