import { test, expect } from '@playwright/test'
import { intelligence } from './fixtures.ts'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: intelligence }))
})

test('source titles containing markup cannot create active elements', async ({ page }) => {
  const title = '<img src=x onerror="document.body.dataset.injected=1"> & public advisory'
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: {
    ...intelligence, news: [{ ...intelligence.news[0], title }], advisories: [{ ...intelligence.advisories[0], title }],
  } }))
  await page.goto('/')
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  await expect(page.locator('#news-records').getByText(title, { exact: true })).toBeVisible()
  await expect(page.locator('#advisory-records').getByText(title, { exact: true })).toBeVisible()
  await expect(page.locator('.hero-brief').getByText(title, { exact: true })).toBeVisible()
  await expect(page.locator('.osint-list img, .hero-brief img')).toHaveCount(0)
  expect(await page.locator('body').getAttribute('data-injected')).toBeNull()
})

test('remote error documents do not leak into dashboard notices', async ({ page }) => {
  await page.route('**/api/live-intel', (route) => route.fulfill({ status: 502, contentType: 'text/html', body: '<h1>private-provider-token-123</h1>' }))
  await page.goto('/')
  await expect(page.locator('.live-status-badge')).toHaveText('Source error')
  await expect(page.locator('.feed-notice')).toContainText('service is unavailable')
  await expect(page.locator('body')).not.toContainText('private-provider-token-123')
  await expect(page.locator('#intel-announcement')).toContainText('Try refreshing')
})

test('production policy blocks injected inline script execution', async ({ page }) => {
  const response = await page.goto('/')
  expect(response?.headers()['content-security-policy']).toContain("script-src 'self'")
  await page.evaluate(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      document.documentElement.dataset.blockedDirective = event.effectiveDirective
    }, { once: true })
    const script = document.createElement('script')
    script.textContent = 'document.documentElement.dataset.inlineScriptRan = "yes"'
    document.body.append(script)
  })
  await expect(page.locator('html')).toHaveAttribute('data-blocked-directive', 'script-src-elem')
  expect(await page.locator('html').getAttribute('data-inline-script-ran')).toBeNull()
})
