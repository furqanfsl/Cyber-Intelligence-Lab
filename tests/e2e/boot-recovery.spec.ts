import { readFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { intelligence } from './fixtures.ts'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: intelligence }))
})

test('a failed application module leaves a readable recovery screen under the production CSP', async ({ page }) => {
  await page.clock.install()
  await page.route('**/assets/*.js', (route) => route.abort())
  const response = await page.goto('/')
  expect(response?.headers()['content-security-policy']).toContain("script-src 'self'")
  await expect(page.locator('#lab-boot')).toHaveAttribute('data-boot-state', 'failed')
  await expect(page.getByRole('heading', { name: "The lab couldn't start" })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Reload lab', exact: true })).toBeVisible()
  await expect(page.locator('#boot-direct')).toBeHidden()
  await page.clock.runFor(9000)
  await expect(page.locator('#lab-boot')).toHaveAttribute('data-boot-state', 'failed')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await page.locator('body').evaluate((body) => getComputedStyle(body).backgroundColor)).toBe('rgb(7, 12, 12)')
})

test('slow startup offers recovery after eight seconds and still mounts when the module arrives', async ({ page }) => {
  await page.clock.install()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/assets/*.js', async (route) => { await gate; await route.continue() })
  try {
    await page.goto('/', { waitUntil: 'commit' })
    await expect(page.locator('#lab-boot')).toHaveAttribute('data-boot-state', 'waiting')
    await expect(page.getByRole('heading', { name: 'Opening the lab', exact: true })).toBeVisible()
    await page.clock.runFor(8100)
    await expect(page.locator('#lab-boot')).toHaveAttribute('data-boot-state', 'slow')
    await expect(page.getByRole('heading', { name: 'The lab is taking longer to open' })).toBeVisible()
    release()
    await expect(page.locator('.site-shell')).toBeVisible()
    await expect(page.locator('#lab-boot')).toHaveCount(0)
  } finally { release() }
})

test('incidental window errors cannot replace an already healthy application', async ({ page }) => {
  await page.clock.install()
  await page.goto('/')
  await expect(page.locator('.site-shell')).toBeVisible()
  await page.evaluate(() => {
    window.dispatchEvent(new ErrorEvent('error', { message: 'An unrelated integration failed' }))
    window.dispatchEvent(new Event('unhandledrejection'))
  })
  await page.clock.runFor(9000)
  await expect(page.getByRole('heading', { name: 'Cyber Intelligence Lab', exact: true })).toBeVisible()
  await expect(page.locator('#lab-boot, .app-recovery')).toHaveCount(0)
})

test('render failures expose a safe retry, not exception details, and an explicit reload can recover', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('boot-render-failure-tested')) {
      sessionStorage.setItem('boot-render-failure-tested', '1')
      window.matchMedia = () => { throw new Error('SENSITIVE_RENDER_FAILURE_DO_NOT_SHOW') }
    }
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'The lab hit a problem' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveText('The interface could not finish rendering. Reload to start a fresh session.')
  await expect(page.locator('body')).not.toContainText('SENSITIVE_RENDER_FAILURE_DO_NOT_SHOW')
  await expect(page.locator('.app-recovery')).toContainText('Your current demo session will reset.')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Reload lab', exact: true }).click()
  await expect(page.locator('.site-shell')).toBeVisible()
  await expect(page.locator('.app-recovery')).toHaveCount(0)
})

for (const [origin, direct] of [
  ['http://127.0.0.1:5500', true],
  ['http://localhost:5173', false],
  ['https://lab.example:5500', false],
] as const) {
  test(`the Vite recovery link is restricted to local Go Live: ${origin}`, async ({ page }) => {
    const files = {
      '/': ['text/html', await readFile(new URL('../../index.html', import.meta.url), 'utf8')],
      '/boot-recovery.js': ['text/javascript', await readFile(new URL('../../public/boot-recovery.js', import.meta.url), 'utf8')],
      '/boot-recovery.css': ['text/css', await readFile(new URL('../../public/boot-recovery.css', import.meta.url), 'utf8')],
    } as const
    await page.route(`${origin}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname as keyof typeof files
      const file = files[path]
      if (file) await route.fulfill({ contentType: file[0], body: file[1] })
      else await route.abort()
    })
    await page.goto(origin)
    await expect(page.locator('#lab-boot')).toHaveAttribute('data-boot-state', 'failed')
    if (direct) {
      await expect(page.getByRole('link', { name: 'Open Vite preview' })).toHaveAttribute('href', 'http://127.0.0.1:5173/')
      await expect(page.locator('#boot-help')).toContainText('npm run dev')
    } else await expect(page.locator('#boot-direct')).toBeHidden()
  })
}
