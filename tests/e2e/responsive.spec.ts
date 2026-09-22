import { test, expect } from '@playwright/test'
import { intelligence } from './fixtures.ts'

for (const width of [320, 768, 1280]) {
  test(`content and controls stay within their frames at ${width}px`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    await page.setViewportSize({ width, height: 900 })
    await page.route('**/api/live-intel', (route) => route.fulfill({ json: intelligence }))
    const response = await page.goto('/')
    expect(response?.headers()['content-security-policy']).toContain("script-src 'self'")
    await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

    for (const [parentSelector, childSelector] of [
      ['.hero-copy', 'h1'],
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
    expect(errors, 'No runtime or resource-policy errors').toEqual([])
  })
}
