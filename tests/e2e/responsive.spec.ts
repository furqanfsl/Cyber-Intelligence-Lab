import { test, expect } from '@playwright/test'
import { intelligence } from './fixtures.ts'
import { navigateWorkspace } from './workspace-helpers.ts'

for (const width of [320, 768, 1280]) {
  test(`content and controls stay within their frames at ${width}px`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    await page.setViewportSize({ width, height: 900 })
    await page.route('**/api/live-intel', (route) => route.fulfill({ json: intelligence }))
    const response = await page.goto('/')
    expect(response?.headers()['content-security-policy']).toContain("script-src 'self'")
    await expect(page.locator('.workspace-view[data-workspace="overview"]')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

    const overview = page.locator('.workspace-view[data-workspace="overview"]')
    const overviewBox = await overview.boundingBox()
    const headingBox = await overview.locator('h1').boundingBox()
    expect(headingBox!.x).toBeGreaterThanOrEqual(overviewBox!.x - 1)
    expect(headingBox!.x + headingBox!.width).toBeLessThanOrEqual(overviewBox!.x + overviewBox!.width + 1)
    await navigateWorkspace(page, 'training')
    for (const [parentSelector, childSelector] of [
      ['.forensic-panel', '[role="tab"]'],
      ['.queue-panel', '.severity-filter button'],
      ['.map-panel', '.map-readout'],
    ]) {
      const parent = page.locator(parentSelector)
      const bounds = await parent.boundingBox()
      expect(bounds).not.toBeNull()
      for (const child of await parent.locator(childSelector).all()) {
        const box = await child.boundingBox()
        expect(box).not.toBeNull()
        expect(box!.x).toBeGreaterThanOrEqual(bounds!.x - 1)
        expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1)
      }
    }
    const visual = await page.locator('.map-panel .map-visual').boundingBox()
    const counter = await page.locator('.map-panel .map-readout').boundingBox()
    expect(visual).not.toBeNull()
    expect(counter).not.toBeNull()
    expect(counter!.y).toBeGreaterThanOrEqual(visual!.y + visual!.height - 1)
    await navigateWorkspace(page, 'live-intel')
    await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(errors, 'No runtime or resource-policy errors').toEqual([])
  })
}
