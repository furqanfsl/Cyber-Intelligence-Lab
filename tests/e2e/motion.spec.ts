import { test, expect } from '@playwright/test'
import { intelligence } from './fixtures.ts'
import { navigateWorkspace } from './workspace-helpers.ts'

test('normal motion reveals scrolled sections and their interactive panels', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: intelligence }))
  await page.goto('/#operations')
  for (const [workspace, selectors] of [
    ['training', ['.map-panel', '.queue-panel', '.forensic-panel']],
    ['live-intel', ['.live-status-panel']],
    ['cases', ['.case-row']],
  ] as const) {
    await navigateWorkspace(page, workspace)
    for (const selector of selectors) {
      const panel = page.locator(selector).first()
      await panel.scrollIntoViewIfNeeded()
      await expect(panel).toHaveClass(/is-visible/)
      await expect(panel).toHaveCSS('opacity', '1')
    }
  }
  // A delayed response must not insert feed cards into an invisible animation state.
  await navigateWorkspace(page, 'live-intel')
  await expect(page.getByRole('link', { name: /Open CISA record/ })).toHaveCSS('opacity', '1')
})

test('reduced motion leaves essential content immediately visible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: intelligence }))
  await page.goto('/#operations')
  for (const selector of ['.map-panel', '.forensic-panel']) {
    await expect(page.locator(selector).first()).toHaveCSS('opacity', '1')
  }
  await expect(page.locator('.map-panel .arc-layer path').first()).toHaveCSS('animation-name', 'none')
  await expect.poll(() => page.locator('.map-panel').evaluate((element) =>
    element.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running').length)).toBe(0)
  await navigateWorkspace(page, 'live-intel')
  await expect(page.locator('.live-status-panel')).toHaveCSS('opacity', '1')
})
