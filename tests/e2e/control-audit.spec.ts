import { expect, test } from '@playwright/test'
import { intelligence } from './fixtures.ts'
import { openSourceDetails, selectFeed } from './feed-helpers.ts'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: intelligence }))
  // A deliberately unsupported fixture allows safe route checks, never PC collection.
  await page.route('**/api/endpoint/*', (route) => route.fulfill({ json: { token: '', platform: 'unsupported', available: false } }))
})

test('every Overview launcher and the home brand open their named workspace without private mutations', async ({ page }) => {
  const mutations: string[] = []
  page.on('request', (request) => { if (request.url().includes('/api/endpoint/') && request.method() !== 'GET') mutations.push(request.url()) })
  await page.goto('/#overview')
  const overview = page.locator('.workspace-view[data-workspace="overview"]')
  const launchers = [
    ['.workspace-primary-actions a[href="#endpoint"]', 'endpoint', 'PC monitoring'],
    ['.workspace-primary-actions a[href="#investigation"]', 'investigation', 'Log investigation'],
    ['.workspace-task-link[href="#live-intel"]', 'live-intel', 'Live intelligence'],
    ['.workspace-task-link[href="#operations"]', 'training', 'Training'],
  ] as const
  for (const [selector, workspace, heading] of launchers) {
    await overview.locator(selector).click()
    await expect(page.locator('.workspace-view:visible')).toHaveAttribute('data-workspace', workspace)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading)
    await expect(page.locator('.nav-links a[aria-current="page"]')).toHaveCount(1)
    await page.getByRole('link', { name: 'Cyber Intelligence Lab home', exact: true }).click()
    await expect(overview).toBeVisible()
    await expect(page).toHaveURL(/#overview$/)
  }
  expect(mutations).toEqual([])
})

test('PC export alternative and Training Change incident links reach their intended local workspaces', async ({ page }) => {
  await page.goto('/#endpoint')
  await page.getByRole('link', { name: /Investigate an exported log instead/ }).click()
  await expect(page).toHaveURL(/#investigation$/)
  await expect(page.locator('.workspace-view:visible')).toHaveAttribute('data-workspace', 'investigation')
  await expect(page.getByLabel('Import log file', { exact: true })).toBeEnabled()
  await page.goto('/#response')
  await expect(page.locator('#response')).toBeFocused()
  const selected = await page.locator('#selected-demo-alert').getAttribute('data-incident-id')
  await page.getByRole('link', { name: /Change incident/ }).click()
  await expect(page).toHaveURL(/#operations$/)
  await expect(page.locator('.workspace-view:visible')).toHaveAttribute('data-workspace', 'training')
  await expect(page.locator('#workspace-heading-training')).toBeFocused()
  await expect(page.locator('#selected-demo-alert')).toHaveAttribute('data-incident-id', selected!)
  await expect(page.locator('.queue-row')).toHaveCount(5)
})

test('all three public records and publisher links actually open isolated new tabs at the exact safe URLs', async ({ page, context }) => {
  const referred: string[] = []
  // Validate browser behavior without depending on any upstream availability or sending traffic.
  const destinations = [
    intelligence.kev[0].url, intelligence.advisories[0].url, intelligence.news[0].url,
    'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
    'https://api.msrc.microsoft.com/cvrf/v3.0/updates', 'https://hn.algolia.com/api',
  ]
  for (const destination of destinations) await context.route(destination, (route) => {
    const referer = route.request().headers().referer
    if (referer) referred.push(referer)
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Explicit browser destination fixture</title><h1>Explicit browser destination fixture</h1>' })
  })
  await page.goto('/#live-intel')
  for (const [feed, name, destination] of [
    ['kev', /Open CISA record/, destinations[0]],
    ['advisory', /Open Microsoft advisory/, destinations[1]],
    ['news', /Open discussion record/, destinations[2]],
  ] as const) {
    await selectFeed(page, feed)
    const popup = page.waitForEvent('popup')
    await page.getByRole('link', { name }).click()
    const opened = await popup
    await expect(opened).toHaveURL(destination)
    await expect(opened.getByRole('heading', { name: 'Explicit browser destination fixture' })).toBeVisible()
    expect(await opened.evaluate(() => window.opener === null)).toBe(true)
    await opened.close()
    await expect(page).toHaveURL(/#live-intel$/)
  }
  await openSourceDetails(page)
  await page.locator('.source-assurance > summary').click()
  for (const [name, destination] of [
    [/CISA source feed/, destinations[3]], [/Microsoft source feed/, destinations[4]], [/HN search API/, destinations[5]],
  ] as const) {
    const popup = page.waitForEvent('popup')
    await page.getByRole('link', { name }).click()
    const opened = await popup
    await expect(opened).toHaveURL(destination)
    await expect(opened.getByRole('heading', { name: 'Explicit browser destination fixture' })).toBeVisible()
    expect(await opened.evaluate(() => window.opener === null)).toBe(true)
    await opened.close()
  }
  expect(referred).toEqual([])
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
})

test('snapshot search enforces its input bound and Clear restores the complete current source', async ({ page }) => {
  await page.goto('/#live-intel')
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  const search = page.getByRole('searchbox', { name: 'Search this snapshot' })
  await search.fill('x'.repeat(200))
  await expect(search).toHaveValue('x'.repeat(160))
  await expect(page.locator('.intel-results')).toHaveText('0 matching records across all sources')
  await page.getByRole('button', { name: 'Clear search', exact: true }).click()
  await expect(search).toHaveValue('')
  await expect(page.locator('#kev-records a')).toHaveCount(1)
  await expect(page.locator('.intel-results')).toHaveText('3 records in this snapshot')
})

test('both Training response links keep native modified-click defaults and plain activation opens the selected modal', async ({ page }) => {
  await page.goto('/#operations')
  const links = page.locator('.workspace-steps a[href="#response"], .alert-panel a[href="#response"]')
  await expect(links).toHaveCount(2)
  for (const link of await links.all()) {
    // Observe React's cancellation at document bubbling, then cancel only the fixture's browser navigation.
    for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      expect(await link.evaluate((element, options) => {
        let cancelledByApp: boolean | undefined
        document.addEventListener('click', (event) => { cancelledByApp = event.defaultPrevented; event.preventDefault() }, { once: true })
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...options }))
        return cancelledByApp
      }, modifiers)).toBe(false)
      await expect(page.locator('dialog.incident-workspace')).not.toBeVisible()
      await expect(page).toHaveURL(/#operations$/)
    }
    await link.click()
    await expect(page.locator('dialog.incident-workspace')).toBeVisible()
    await expect(page).toHaveURL(/#operations$/)
    const selected = await page.locator('#selected-demo-alert').getAttribute('data-incident-id')
    await expect(page.locator('dialog.incident-workspace')).toHaveAttribute('data-incident-id', selected!)
    await page.keyboard.press('Escape')
    await expect(link).toBeFocused()
  }
})
