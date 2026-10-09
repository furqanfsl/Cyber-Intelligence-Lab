import { expect, test } from '@playwright/test'
import { intelligence } from './fixtures.ts'
import { navigateWorkspace } from './workspace-helpers.ts'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: intelligence }))
})

test('motion control pauses decoration without starting simulated telemetry and persists', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/#operations')
  const shell = page.locator('.site-shell')
  await expect(shell).toHaveAttribute('data-motion', 'on')
  await expect(page.getByRole('button', { name: 'Start simulation', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: 'Motion on', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Motion off', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await expect(shell).toHaveAttribute('data-motion', 'off')
  expect(await shell.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0)
  await page.reload()
  await expect(shell).toHaveAttribute('data-motion', 'off')
  await page.getByRole('button', { name: 'Motion off', exact: true }).click()
  await expect(shell).toHaveAttribute('data-motion', 'on')
  await expect(page.locator('.map-panel .instrument-sweep')).toHaveCSS('animation-play-state', 'running')
})

test('system reduced motion always wins and responds to preference changes', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cil-motion', 'on'))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/#operations')
  const control = page.getByRole('button', { name: 'Motion off', exact: true })
  await expect(control).toBeDisabled()
  await expect(control).toHaveAttribute('title', /reduced-motion setting/)
  expect(await page.locator('.site-shell').evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0)
  for (const selector of ['.ops-grid', '.queue-panel', '.response-grid']) {
    await expect(page.locator(selector)).toHaveCSS('opacity', '1')
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(page.getByRole('button', { name: 'Motion on', exact: true })).toBeEnabled()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(control).toBeDisabled()
  await expect(page.locator('.map-panel .instrument-sweep')).toHaveCSS('animation-name', 'none')
  await navigateWorkspace(page, 'cases')
  await expect(page.locator('.case-table')).toHaveCSS('opacity', '1')
})

test('motion control still works when local storage is unavailable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('Storage denied') } })
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/#operations')
  await page.getByRole('button', { name: 'Motion on', exact: true }).click()
  await expect(page.locator('.site-shell')).toHaveAttribute('data-motion', 'off')
  expect(errors).toEqual([])
})

test('hidden tabs pause ambient effects and resume without changing motion preference', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/#operations')
  const orbit = page.locator('.map-panel .instrument-sweep')
  await expect(orbit).toHaveCSS('animation-play-state', 'running')
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(orbit).toHaveCSS('animation-play-state', 'paused')
  await expect(page.locator('.site-shell')).toHaveAttribute('data-motion', 'on')
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(orbit).toHaveCSS('animation-play-state', 'running')
})

test('keyboard focus immediately reveals content even before an intersection callback', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.addInitScript(() => {
    Object.defineProperty(window, 'IntersectionObserver', { configurable: true, value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } })
  })
  await page.goto('/#operations')
  const file = page.getByRole('tab', { name: 'File', exact: true })
  await file.focus()
  await expect(file).toBeFocused()
  await expect(page.locator('.forensic-panel')).toHaveCSS('opacity', '1')
  await expect(page.locator('.forensic-panel')).toHaveCSS('transition-duration', '0s')
  await expect(page.locator('.response-grid')).toHaveCSS('opacity', '1')
  await expect(page.locator('.response-grid')).toHaveCSS('transform', 'none')
})

test('tall sections are never gated by nested reveals in a short viewport', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 390, height: 360 })
  await page.goto('/#operations')
  for (const selector of ['.ops-grid', '.response-grid']) {
    await expect(page.locator(selector)).toHaveCSS('opacity', '1')
    await expect(page.locator(selector)).toHaveCSS('transform', 'none')
  }
  for (const selector of ['.queue-panel', '.forensic-panel']) {
    const panel = page.locator(selector).first()
    await panel.scrollIntoViewIfNeeded()
    await expect(panel).toHaveCSS('opacity', '1')
  }
  await navigateWorkspace(page, 'cases')
  await expect(page.locator('.case-table')).toHaveCSS('opacity', '1')
  await expect(page.locator('.case-table')).toHaveCSS('transform', 'none')
  await page.locator('.case-row').first().scrollIntoViewIfNeeded()
  await expect(page.locator('.case-row').first()).toHaveCSS('opacity', '1')
})

test('map regions, totals and priorities stay readable without decoration collisions or doubled-text overlap', async ({ page }) => {
  await page.goto('/#operations')
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    const collisions = await page.locator('.threat-map').evaluateAll((maps) => maps.flatMap((map) => {
      const bounds = map.querySelector('.lab-instrument')!.getBoundingClientRect()
      return [...map.querySelectorAll('.map-caption, .map-node strong, .map-node data, .map-readout')]
        .filter((element) => {
          const rect = element.getBoundingClientRect()
          return rect.left < bounds.right && rect.right > bounds.left && rect.top < bounds.bottom && rect.bottom > bounds.top
        }).map((element) => element.textContent)
    }))
    expect(collisions).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const control = page.getByRole('button', { name: 'Motion off', exact: true })
    const bounds = await control.boundingBox()
    expect(bounds!.height).toBeGreaterThanOrEqual(44)
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    // A fresh document prevents text scaling from accumulating between widths.
    await page.reload()
    const label = page.locator('.map-panel .map-node strong').first()
    const initialSize = await label.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
    await page.evaluate(() => {
      const sizes = Array.from(document.querySelectorAll<HTMLElement>('.workspace-view[data-workspace="training"], .workspace-view[data-workspace="training"] *'))
        .map((element) => ({ element, size: Number.parseFloat(getComputedStyle(element).fontSize) }))
      for (const { element, size } of sizes) element.style.fontSize = `${size * 2}px`
    })
    expect(await label.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(initialSize * 1.95)
    const geometry = await page.locator('.map-panel .map-visual').evaluate((visual) => {
      const frame = visual.getBoundingClientRect()
      const labels = [...visual.querySelectorAll('.map-node strong, .map-node data')].map((element) => {
        const bounds = element.getBoundingClientRect()
        return { text: element.textContent, x: bounds.x, right: bounds.right, y: bounds.y, bottom: bounds.bottom }
      })
      const collisions = labels.flatMap((label, index) => labels.slice(index + 1).filter((other) =>
        label.x < other.right - 0.5 && label.right > other.x + 0.5 && label.y < other.bottom - 0.5 && label.bottom > other.y + 0.5)
        .map((other) => [label.text, other.text]))
      return { frame: { x: frame.x, right: frame.right, y: frame.y, bottom: frame.bottom }, labels, collisions }
    })
    expect(geometry.labels).toHaveLength(12)
    expect(geometry.collisions).toEqual([])
    for (const bounds of geometry.labels) {
      expect(bounds.x).toBeGreaterThanOrEqual(geometry.frame.x - 1)
      expect(bounds.right).toBeLessThanOrEqual(geometry.frame.right + 1)
      expect(bounds.y).toBeGreaterThanOrEqual(geometry.frame.y - 1)
      expect(bounds.bottom).toBeLessThanOrEqual(geometry.frame.bottom + 1)
    }
    for (const value of await page.locator('.map-panel .map-readout data, .actions-list strong').all()) {
      expect(await value.evaluate((element) => {
        const range = document.createRange()
        range.selectNodeContents(element)
        return range.getClientRects().length
      })).toBe(1)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

test('artifact transitions stay brief and motion-off content remains keyboard visible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/#operations')
  await page.getByRole('tab', { name: 'Network', exact: true }).click()
  const panel = page.locator('.forensic-panel').getByRole('tabpanel')
  await expect(panel).toHaveCSS('animation-name', 'lab-content-arrive')
  await expect(panel).toHaveCSS('animation-duration', '0.18s')
  await page.getByRole('button', { name: 'Motion on', exact: true }).click()
  await page.getByRole('tab', { name: 'Registry', exact: true }).click()
  await panel.focus()
  await expect(panel).toBeFocused()
  await expect(panel).toHaveCSS('opacity', '1')
  await expect(panel).toHaveCSS('animation-name', 'none')
})

test('the source checking light only animates while a real request is pending', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  let requests = 0
  let release: () => void = () => {}
  const pending = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/api/live-intel', async (route) => {
    if (++requests > 1) await pending
    await route.fulfill({ json: intelligence })
  })
  await page.goto('/#live-intel')
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  const light = () => page.locator('.live-status-panel').evaluate((node) => getComputedStyle(node, '::after').animationName)
  expect(await light()).toBe('none')
  await page.getByRole('button', { name: 'Refresh sources', exact: true }).click()
  await expect(page.locator('.live-status-panel')).toHaveAttribute('aria-busy', 'true')
  expect(await light()).toBe('source-check')
  await navigateWorkspace(page, 'training')
  await page.getByRole('button', { name: 'Motion on', exact: true }).click()
  await navigateWorkspace(page, 'live-intel')
  expect(await light()).toBe('none')
  release()
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  expect(await light()).toBe('none')
})
