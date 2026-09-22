import { test, expect } from '@playwright/test'
import { intelligence } from './fixtures.ts'

test('normal motion reveals scrolled sections and their interactive panels', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: intelligence }))
  await page.goto('/')
  await expect(page.locator('.hero-copy')).toHaveCSS('opacity', '1')
  for (const selector of ['.map-panel', '.queue-panel', '.live-status-panel', '.forensic-panel', '.case-row']) {
    const panel = page.locator(selector).first()
    await panel.scrollIntoViewIfNeeded()
    await expect(panel).toHaveClass(/is-visible/)
    await expect(panel).toHaveCSS('opacity', '1')
  }
  // A delayed response must not insert feed cards into an invisible animation state.
  await expect(page.getByRole('link', { name: /Open CISA record/ })).toHaveCSS('opacity', '1')
})

test('reduced motion leaves essential content immediately visible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: intelligence }))
  await page.goto('/')
  for (const selector of ['.hero-copy', '.map-panel', '.live-status-panel', '.forensic-panel']) {
    await expect(page.locator(selector).first()).toHaveCSS('opacity', '1')
  }
  await expect(page.locator('.map-panel .arc-layer path').first()).toHaveCSS('animation-name', 'none')
  await expect.poll(() => page.locator('.map-panel').evaluate((element) =>
    element.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running').length)).toBe(0)
})
