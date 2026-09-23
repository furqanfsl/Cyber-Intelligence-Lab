import { test, expect } from '@playwright/test'

test.use({ javaScriptEnabled: false })

test('explains how to recover when JavaScript is disabled', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  const response = await page.goto('/')
  expect(response?.status()).toBe(200)
  await expect(page.locator('noscript')).toBeVisible()
  // Playwright's normalized text matcher intentionally skips noscript content.
  expect(await page.locator('noscript').textContent()).toContain('Enable JavaScript, then reload this page.')
  await expect(page.locator('#root #lab-boot h1')).toHaveText('Opening the lab')
  await expect(page.locator('#root #lab-boot')).toBeVisible()
  expect(requests.filter((url) => url.includes('/api/live-intel'))).toEqual([])
})
