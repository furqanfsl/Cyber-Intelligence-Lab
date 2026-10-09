import { readFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import type { Page, Route } from '@playwright/test'

const handoffOrigin = 'http://127.0.0.1:5500'
const previewOrigin = 'http://127.0.0.1:5173'
const healthyHtml = '<!doctype html><html><head><title>Cyber Intelligence Lab</title><script type="module" src="/@vite/client"></script></head><body><h1>Preview ready</h1></body></html>'

type DeferredProbeWindow = typeof window & {
  deferredHandoffProbes: Array<{
    signal: AbortSignal | null | undefined
    finish: (html: string) => void
  }>
}

// Serve the real static handoff without starting/stopping Live Server or Vite.
// Every request is intercepted, so these checks cannot depend on a developer's ports.
async function mockHandoff(page: Page, options: {
  origin?: string
  probe?: (route: Route, attempt: number) => Promise<void>
} = {}) {
  const origin = options.origin ?? handoffOrigin
  const files: Record<string, { contentType: string; body: string }> = {
    '/': { contentType: 'text/html', body: await readFile(new URL('../../preview/index.html', import.meta.url), 'utf8') },
    '/launch.css': { contentType: 'text/css', body: await readFile(new URL('../../preview/launch.css', import.meta.url), 'utf8') },
    '/launch.js': { contentType: 'text/javascript', body: await readFile(new URL('../../preview/launch.js', import.meta.url), 'utf8') },
  }
  const probes: string[] = []
  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === origin) {
      const file = files[url.pathname]
      if (file) await route.fulfill(file)
      else await route.abort()
      return
    }
    if (url.origin === previewOrigin && url.pathname === '/') {
      if (request.isNavigationRequest()) {
        await route.fulfill({ contentType: 'text/html', body: healthyHtml })
      } else {
        expect(request.method()).toBe('GET')
        probes.push(request.url())
        if (options.probe) await options.probe(route, probes.length)
        else await route.abort('connectionrefused')
      }
      return
    }
    if (url.origin === previewOrigin && url.pathname === '/@vite/client') {
      await route.fulfill({ contentType: 'text/javascript', body: '' })
      return
    }
    await route.abort()
  })
  return { origin, probes }
}

async function healthyPreview(route: Route) {
  await route.fulfill({
    contentType: 'text/html',
    headers: { 'access-control-allow-origin': '*' },
    body: healthyHtml,
  })
}

test('Go Live remains readable and offers startup instructions when Vite is stopped', async ({ page }) => {
  await page.clock.install()
  const { probes } = await mockHandoff(page)
  await page.goto(handoffOrigin)
  await expect(page.getByRole('heading', { name: 'Open Cyber Intelligence Lab', exact: true })).toBeVisible()
  await expect.poll(() => probes.length).toBe(1)
  await expect(page.getByRole('button', { name: 'Retry connection', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open preview', exact: true })).toHaveAttribute('href', `${previewOrigin}/`)
  await expect(page.locator('body')).toContainText('start.bat')
  await expect(page.locator('body')).toContainText(/Ctrl\s*\+\s*Shift\s*\+\s*B/)
  await expect(page.locator('body')).toContainText('npm run dev')
  await expect(page.locator('body')).not.toContainText('ECONNREFUSED')
  expect(page.url()).toBe(`${handoffOrigin}/`)
})

test('Go Live announces its initial connection check before the probe completes', async ({ page }) => {
  await page.clock.install()
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  await mockHandoff(page, { probe: async (route) => { await pending; await route.abort('connectionrefused') } })
  try {
    await page.goto(handoffOrigin)
    await expect(page.getByRole('status')).toHaveText('Checking the local preview…')
    await expect(page.getByRole('heading', { name: 'Open Cyber Intelligence Lab', exact: true })).toBeVisible()
  } finally {
    release()
  }
})

test('Go Live opens a newly started healthy Vite preview and preserves the section hash', async ({ page }) => {
  await page.clock.install()
  const { probes } = await mockHandoff(page, {
    probe: async (route, attempt) => {
      if (attempt < 3) await route.abort('connectionrefused')
      else await healthyPreview(route)
    },
  })
  await page.goto(`${handoffOrigin}/#live-intelligence`)
  await expect.poll(() => probes.length).toBe(1)
  for (let attempt = 2; attempt <= 3; attempt++) {
    await page.clock.runFor(1100)
    await expect.poll(() => probes.length).toBe(attempt)
  }
  await expect(page).toHaveURL(`${previewOrigin}/#live-intelligence`)
  await expect(page.getByRole('heading', { name: 'Preview ready' })).toBeVisible()
  expect(probes.every((url) => new URL(url).origin === previewOrigin)).toBe(true)
})

test('Go Live rejects unrelated, non-Vite, non-HTML, and unsuccessful responses', async ({ page }) => {
  await page.clock.install()
  const invalid = [
    { body: healthyHtml.replace('Cyber Intelligence Lab', 'Unrelated project'), contentType: 'text/html', status: 200 },
    { body: '<title>Cyber Intelligence Lab</title><h1>A static export</h1>', contentType: 'text/html', status: 200 },
    { body: healthyHtml, contentType: 'text/plain', status: 200 },
    { body: healthyHtml, contentType: 'text/html', status: 503 },
  ]
  const { probes } = await mockHandoff(page, {
    probe: (route, attempt) => route.fulfill({
      ...invalid[Math.min(attempt - 1, invalid.length - 1)],
      headers: { 'access-control-allow-origin': '*' },
    }),
  })
  await page.goto(handoffOrigin)
  for (let attempt = 1; attempt <= invalid.length; attempt++) {
    await expect.poll(() => probes.length).toBe(attempt)
    await expect(page.getByRole('status')).not.toHaveText('Checking the local preview…')
    expect(page.url()).toBe(`${handoffOrigin}/`)
    if (attempt < invalid.length) await page.clock.runFor(1100)
  }
  await expect(page.getByRole('button', { name: 'Retry connection', exact: true })).toBeVisible()
})

test('automatic checks are bounded and Retry connection starts a fresh attempt', async ({ page }) => {
  await page.clock.install()
  let ready = false
  const { probes } = await mockHandoff(page, {
    probe: async (route) => {
      if (ready) await healthyPreview(route)
      else await route.abort('connectionrefused')
    },
  })
  await page.goto(handoffOrigin)
  for (let attempt = 1; attempt <= 30; attempt++) {
    await expect.poll(() => probes.length).toBe(attempt)
    await expect(page.getByRole('status')).not.toHaveText('Checking the local preview…')
    if (attempt < 30) await page.clock.runFor(1100)
  }
  await page.clock.runFor(65_000)
  expect(probes).toHaveLength(30)
  expect(page.url()).toBe(`${handoffOrigin}/`)
  ready = true
  const retry = page.getByRole('button', { name: 'Retry connection', exact: true })
  await expect(retry).toBeEnabled()
  await retry.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(`${previewOrigin}/`)
  expect(probes).toHaveLength(31)
})

test('a restored Go Live page starts fresh checks and retains a working Retry connection', async ({ page }) => {
  await page.clock.install()
  let ready = false
  const { probes } = await mockHandoff(page, {
    probe: async (route) => {
      if (ready) await healthyPreview(route)
      else await route.abort('connectionrefused')
    },
  })
  await page.goto(`${handoffOrigin}/#live-intelligence`)
  await expect.poll(() => probes.length).toBe(1)
  await expect(page.getByRole('status')).not.toHaveText('Checking the local preview…')

  // Exercise the exact persisted-page lifecycle deterministically. Routing can
  // disable Chromium's actual BFCache, so this is not a browser-cache guarantee.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })))
  await page.clock.runFor(2100)
  expect(probes).toHaveLength(1)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
  await expect.poll(() => probes.length).toBe(2)

  for (let attempt = 1; attempt <= 30; attempt++) {
    await expect.poll(() => probes.length).toBe(attempt + 1)
    await expect(page.getByRole('status')).not.toHaveText('Checking the local preview…')
    if (attempt < 30) await page.clock.runFor(1100)
  }
  await page.clock.runFor(65_000)
  expect(probes).toHaveLength(31)
  expect(page.url()).toBe(`${handoffOrigin}/#live-intelligence`)
  await expect(page.getByRole('button', { name: 'Retry connection', exact: true })).toBeEnabled()
  ready = true
  await page.getByRole('button', { name: 'Retry connection', exact: true }).click()
  await expect(page).toHaveURL(`${previewOrigin}/#live-intelligence`)
  expect(probes).toHaveLength(32)
})

test('a cancelled old probe cannot redirect or unlock a restored page’s fresh pending check', async ({ page }) => {
  await page.clock.install()
  await mockHandoff(page)
  await page.addInitScript(({ preview }) => {
    const target = window as DeferredProbeWindow
    const originalFetch = window.fetch.bind(window)
    target.deferredHandoffProbes = []
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url !== preview) return originalFetch(input, init)
      // Deliberately defer completion even after abort: an obsolete asynchronous
      // completion must not mutate the replacement connection generation.
      return new Promise<Response>((resolve) => {
        target.deferredHandoffProbes.push({
          signal: init?.signal,
          finish: (html) => resolve(new Response(html, { headers: { 'content-type': 'text/html' } })),
        })
      })
    }
  }, { preview: `${previewOrigin}/` })
  await page.goto(handoffOrigin)
  await expect.poll(() => page.evaluate(() => (window as DeferredProbeWindow).deferredHandoffProbes.length)).toBe(1)
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
  })
  await expect.poll(() => page.evaluate(() => (window as DeferredProbeWindow).deferredHandoffProbes.length)).toBe(2)
  expect(await page.evaluate(() => (window as DeferredProbeWindow).deferredHandoffProbes.map((probe) => probe.signal?.aborted))).toEqual([true, false])
  await page.evaluate(async (html) => {
    const target = window as DeferredProbeWindow
    target.deferredHandoffProbes[0].finish(html)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  }, healthyHtml)
  await expect(page.getByRole('status')).toHaveText('Checking the local preview…')
  await expect(page.getByRole('button', { name: 'Retry connection', exact: true })).toBeDisabled()
  expect(page.url()).toBe(`${handoffOrigin}/`)
  await page.evaluate(() => document.getElementById('retry')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  expect(await page.evaluate(() => (window as DeferredProbeWindow).deferredHandoffProbes.length)).toBe(2)
  await page.evaluate((html) => (window as DeferredProbeWindow).deferredHandoffProbes[1].finish(html), healthyHtml)
  await expect(page).toHaveURL(`${previewOrigin}/`)
  await expect(page.getByRole('heading', { name: 'Preview ready' })).toBeVisible()
})

for (const host of ['localhost', '[::1]']) {
  test(`Go Live accepts the loopback hostname ${host}`, async ({ page }) => {
    const origin = `http://${host}:5500`
    await mockHandoff(page, { origin, probe: healthyPreview })
    await page.goto(origin)
    await expect(page).toHaveURL(`${previewOrigin}/`)
    await expect(page.getByRole('heading', { name: 'Preview ready' })).toBeVisible()
  })
}

test('a deployed handoff never probes or redirects to the visitor’s localhost', async ({ page }) => {
  await page.clock.install()
  const origin = 'https://lab.example:5500'
  const { probes } = await mockHandoff(page, { origin, probe: healthyPreview })
  await page.goto(origin)
  await page.clock.runFor(65_000)
  expect(probes).toHaveLength(0)
  expect(page.url()).toBe(`${origin}/`)
  await expect(page.getByRole('heading', { name: 'Open Cyber Intelligence Lab', exact: true })).toBeVisible()
  await expect(page.locator('#retry')).toHaveAttribute('hidden', '')
  await expect(page.locator('#retry')).toBeHidden()
  await expect(page.locator('#open-preview')).toHaveAttribute('hidden', '')
  await expect(page.locator('#open-preview')).toBeHidden()
  expect(await page.locator('#open-preview').boundingBox()).toBeNull()
})

test('the Go Live instructions and controls fit a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await mockHandoff(page)
  await page.goto(handoffOrigin)
  await expect(page.getByRole('heading', { name: 'Open Cyber Intelligence Lab', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  for (const control of [
    page.getByRole('button', { name: 'Retry connection', exact: true }),
    page.getByRole('link', { name: 'Open preview', exact: true }),
  ]) {
    const bounds = await control.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320)
    expect(bounds!.height).toBeGreaterThanOrEqual(44)
  }
})

test.describe('Go Live without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('retains the manual startup and direct preview instructions', async ({ page }) => {
    const { probes } = await mockHandoff(page)
    await page.goto(handoffOrigin)
    await expect(page.getByRole('heading', { name: 'Open Cyber Intelligence Lab', exact: true })).toBeVisible()
    await expect(page.locator('body')).toContainText('start.bat')
    await expect(page.locator('body')).toContainText('npm run dev')
    await expect(page.getByRole('link', { name: 'Open preview', exact: true })).toHaveAttribute('href', `${previewOrigin}/`)
    await expect(page.locator('noscript')).toBeVisible()
    expect(probes).toHaveLength(0)
    expect(page.url()).toBe(`${handoffOrigin}/`)
  })
})
