import { test, expect } from '@playwright/test'
import { intelligence } from './fixtures.ts'
import { selectForPageReview } from './demo-helpers.ts'

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

test('a copied brief follows the current selected incident', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async (text: string) => { document.documentElement.dataset.copiedBrief = text },
  } }))
  await page.goto('/')
  await selectForPageReview(page, page.locator('.queue-row[data-template-id="A78-4319"]'))
  const previousId = await page.locator('.alert-panel').getAttribute('data-incident-id')
  await page.locator('.severity-filter').getByRole('button', { name: 'low', exact: true }).click()
  const selectedId = await page.locator('.alert-panel').getAttribute('data-incident-id')
  const selectedTitle = await page.locator('.alert-panel h3').textContent()
  const selectedAsset = await page.locator('.alert-panel').getAttribute('data-asset')
  await page.getByRole('button', { name: 'Copy brief', exact: true }).click()
  await expect(page.locator('.copy-feedback')).toContainText('copied')
  const brief = await page.evaluate(() => document.documentElement.dataset.copiedBrief)
  expect(brief).toContain(selectedId!)
  expect(brief).toContain(selectedTitle!)
  expect(brief).toContain(selectedAsset!)
  expect(brief).not.toContain(previousId!)
})

test('an old pending clipboard write cannot confirm a newly selected incident', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: () => new Promise<void>((resolve) => { window.addEventListener('finish-demo-copy', () => resolve(), { once: true }) }),
  } }))
  await page.goto('/')
  await selectForPageReview(page, page.locator('.queue-row[data-template-id="A78-4319"]'))
  await page.getByRole('button', { name: 'Copy brief', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Copying…', exact: true })).toBeDisabled()
  await page.locator('.severity-filter').getByRole('button', { name: 'low', exact: true }).click()
  await page.evaluate(() => window.dispatchEvent(new Event('finish-demo-copy')))
  await expect(page.getByRole('button', { name: 'Copy brief', exact: true })).toBeEnabled()
  await expect(page.locator('.copy-feedback')).toBeEmpty()
  await expect(page.getByRole('button', { name: 'Brief copied', exact: true })).toHaveCount(0)
})

test('all artifact tabs expose distinct panels and one tab stop', async ({ page }) => {
  await page.goto('/')
  const contents = new Set<string>()
  for (const name of ['File', 'Network', 'Process', 'Registry']) {
    await page.getByRole('tab', { name, exact: true }).click()
    await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('[role="tab"][tabindex="0"]')).toHaveCount(1)
    const panel = page.getByRole('tabpanel')
    await expect(panel).toHaveAttribute('aria-labelledby', 'artifact-tab-' + name.toLowerCase())
    contents.add((await panel.textContent())!)
  }
  expect(contents.size).toBe(4)
  await expect(page.getByRole('checkbox')).toHaveCount(0)
})

test('response opens the selected investigation and back-to-top still navigates', async ({ page }) => {
  await page.goto('/')
  const response = page.getByRole('link', { name: 'View response', exact: true })
  const selectedId = await page.locator('.alert-panel').getAttribute('data-incident-id')
  await response.click()
  await expect(page.locator('dialog.incident-workspace')).toBeVisible()
  await expect(page.locator('dialog.incident-workspace')).toHaveAttribute('data-incident-id', selectedId!)
  await page.keyboard.press('Escape')
  await expect(response).toBeFocused()
  await page.getByRole('link', { name: /Back to top/ }).click()
  await expect(page).toHaveURL(/#top$/)
  await expect(page.getByRole('heading', { level: 1 })).toBeInViewport()
})
