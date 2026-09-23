import { expect, test, type Page } from '@playwright/test'
import { intelligence } from './fixtures.ts'
import { createDemoIncident } from '../../src/lib/demo-scenarios.ts'
import { expectCompleteDossier, readDemoSession, selectForPageReview } from './demo-helpers.ts'

test.beforeEach(async ({ page }) => {
  await page.clock.install()
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: intelligence }))
})

async function sessionId(page: Page) {
  const id = await page.locator('.simulation-console').getAttribute('data-session-id')
  expect(id).toBeTruthy()
  return id!
}

async function queueIds(page: Page) {
  return page.locator('.queue-row').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-incident-id')))
}

async function expectSelectedIncident(page: Page, id: string) {
  const row = page.locator(`.queue-row[data-incident-id="${id}"]`)
  await expect(row).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.queue-row[aria-pressed="true"]')).toHaveCount(1)
  const title = await row.locator('strong').textContent()
  const asset = await row.getAttribute('data-asset')
  await expect(page.locator('.alert-panel')).toHaveAttribute('data-incident-id', id)
  await expect(page.locator('.alert-panel')).toHaveAttribute('data-asset', asset!)
  await expect(page.locator('.alert-panel h3')).toHaveText(title!)
  await expect(page.locator('#response')).toHaveAttribute('data-incident-id', id)
  await expect(page.locator('#response')).toHaveAttribute('data-asset', asset!)
  await expect(page.locator('.scenario-summary')).toContainText(asset!)
  await expect(page.locator('.risk-grid > div').nth(1).locator('strong')).toHaveText(title!)
}

test('every latest activity row opens its corresponding evidence and response, not an unrelated queue incident', async ({ page }) => {
  await page.goto('/')
  const session = await readDemoSession(page)
  await page.getByRole('button', { name: 'Start simulation', exact: true }).click()
  for (let batch = 2; batch <= 3; batch++) await page.clock.fastForward(2600)
  await page.getByRole('button', { name: 'Pause simulation', exact: true }).click()
  const buttons = page.locator('.simulation-event-list li button')
  await expect(buttons).toHaveCount(3)
  const ids = await buttons.evaluateAll((items) => items.map((item) => item.getAttribute('data-incident-id')!))
  expect(new Set(ids).size).toBe(3)
  for (const id of ids) {
    const button = page.locator(`.simulation-event-list button[data-incident-id="${id}"]`)
    await selectForPageReview(page, button)
    await expect(button).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.simulation-event-list button[aria-pressed="true"]')).toHaveCount(1)
    await expectSelectedIncident(page, id)
    await expect(button).toBeFocused()
    const batch = Number(await button.locator('..').getAttribute('data-batch'))
    await expectCompleteDossier(page, createDemoIncident(session.seed, batch))
  }
})

test('selecting a running activity pauses review and clears a severity filter without losing its report', async ({ page }) => {
  await page.goto('/')
  await page.locator('.severity-filter').getByRole('button', { name: 'low', exact: true }).click()
  await page.getByRole('button', { name: 'Start simulation', exact: true }).click()
  const button = page.locator('.simulation-event-list li button').first()
  const id = (await button.getAttribute('data-incident-id'))!
  await selectForPageReview(page, button)
  await expect(page.locator('.simulation-console')).toHaveAttribute('data-state', 'paused')
  await expect(page.locator('.severity-filter').getByRole('button', { name: 'all', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expectSelectedIncident(page, id)
  const report = await page.locator('#response').textContent()
  await page.clock.fastForward(26_000)
  await expect(page.locator('.simulation-session-count')).toHaveText('+7')
  await expect(page.locator('#response')).toHaveText(report!)
})

test('latest activity is keyboard-selectable and touch-sized at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Start simulation', exact: true }).click()
  await page.clock.fastForward(2600)
  const buttons = page.locator('.simulation-event-list li button')
  const firstId = (await buttons.first().getAttribute('data-incident-id'))!
  await buttons.first().focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('dialog.incident-workspace')).toHaveAttribute('data-incident-id', firstId)
  await page.keyboard.press('Escape')
  await expectSelectedIncident(page, firstId)
  const secondId = (await buttons.last().getAttribute('data-incident-id'))!
  await buttons.last().focus()
  await page.keyboard.press('Space')
  await expect(page.locator('dialog.incident-workspace')).toHaveAttribute('data-incident-id', secondId)
  await page.keyboard.press('Escape')
  await expectSelectedIncident(page, secondId)
  for (const button of await buttons.all()) {
    const box = await button.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(320)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('a selected generated incident stays pinned with a stable report as new randomized batches arrive', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Start simulation', exact: true }).click()
  const button = page.locator('.simulation-event-list li button').first()
  const id = (await button.getAttribute('data-incident-id'))!
  await selectForPageReview(page, button)
  await expectSelectedIncident(page, id)
  const report = await page.locator('#response').textContent()
  await page.getByRole('button', { name: 'Resume simulation', exact: true }).click()
  for (let batch = 2; batch <= 12; batch++) {
    await page.clock.fastForward(2600)
    await expect(page.locator('.simulation-session-count')).toHaveText(`+${batch * 7}`)
    await expectSelectedIncident(page, id)
    await expect(page.locator('#response')).toHaveText(report!)
    expect(await page.locator('.queue-row').count()).toBeLessThanOrEqual(9)
  }
  await expect(page.locator(`.simulation-event-list button[data-incident-id="${id}"]`)).toHaveCount(0)
  await expect(page.locator('.simulation-event-list li')).toHaveCount(3)
  const ids = await queueIds(page)
  expect(new Set(ids).size).toBe(ids.length)
})

test('reset creates a new scenario set with fresh complete reports and no old selected evidence', async ({ page }) => {
  await page.goto('/')
  const beforeSession = await sessionId(page)
  const beforeIds = await queueIds(page)
  const beforeAssets = await page.locator('.queue-row').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-asset')))
  await page.getByRole('button', { name: 'Start simulation', exact: true }).click()
  await selectForPageReview(page, page.locator('.simulation-event-list li button').first())
  const oldSelectedId = await page.locator('.alert-panel').getAttribute('data-incident-id')
  const oldSummary = await page.locator('.scenario-summary').textContent()
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click()
  expect(await sessionId(page)).not.toBe(beforeSession)
  await expect(page.locator('.simulation-session-id')).toContainText(await sessionId(page))
  await expect(page.locator('.queue-row')).toHaveCount(5)
  expect((await queueIds(page)).some((id) => beforeIds.includes(id))).toBe(false)
  expect(await page.locator('.queue-row').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-asset')))).not.toEqual(beforeAssets)
  await expect(page.locator('.simulation-event-list li')).toHaveCount(0)
  await expect(page.locator('.simulation-session-count')).toHaveText('+0')
  await expect(page.locator('#response')).not.toHaveAttribute('data-incident-id', oldSelectedId!)
  await expect(page.locator('.scenario-summary')).not.toHaveText(oldSummary!)
  await expect(page.locator('#response')).not.toContainText(oldSelectedId!)
  await expectSelectedIncident(page, (await page.locator('.alert-panel').getAttribute('data-incident-id'))!)
})

test('reload starts a different randomized session while preserving complete severity coverage', async ({ page }) => {
  await page.goto('/')
  const beforeSession = await sessionId(page)
  const beforeIds = await queueIds(page)
  await page.reload()
  expect(await sessionId(page)).not.toBe(beforeSession)
  expect((await queueIds(page)).some((id) => beforeIds.includes(id))).toBe(false)
  expect((await page.locator('.queue-row .queue-severity').allTextContents()).sort()).toEqual(['critical', 'high', 'high', 'low', 'medium'])
  await expect(page.locator('.simulation-console')).toHaveAttribute('data-state', 'ready')
})

test('New scenario set refreshes complete reports before a simulation has ever started', async ({ page }) => {
  await page.goto('/')
  const before = await sessionId(page)
  const previousIds = await queueIds(page)
  const regenerate = page.getByRole('button', { name: /New scenario set/ })
  await regenerate.focus()
  await page.keyboard.press('Enter')
  expect(await sessionId(page)).not.toBe(before)
  expect((await queueIds(page)).some((id) => previousIds.includes(id))).toBe(false)
  await expect(page.locator('.simulation-console')).toHaveAttribute('data-state', 'ready')
  await expect(page.locator('.simulation-session-count')).toHaveText('+0')
  await expect(page.getByRole('button', { name: 'Reset demo', exact: true })).toBeDisabled()
  const session = await readDemoSession(page)
  const selectedId = await page.locator('.alert-panel').getAttribute('data-incident-id')
  await expectCompleteDossier(page, session.initialIncidents.find((incident) => incident.id === selectedId)!)
})

test('regenerating a session invalidates an old pending clipboard result', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: () => new Promise<void>((resolve) => { window.addEventListener('finish-demo-copy', () => resolve(), { once: true }) }),
  } }))
  await page.goto('/')
  const oldSession = await sessionId(page)
  await page.getByRole('button', { name: 'Copy brief', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Copying…', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: /New scenario set/ }).click()
  expect(await sessionId(page)).not.toBe(oldSession)
  await page.evaluate(() => window.dispatchEvent(new Event('finish-demo-copy')))
  await expect(page.getByRole('button', { name: 'Copy brief', exact: true })).toBeEnabled()
  await expect(page.locator('.copy-feedback')).toBeEmpty()
})

test('selecting generated incidents and regenerating demos never changes or refetches public intelligence', async ({ page }) => {
  let requests = 0
  await page.route('**/api/live-intel', (route) => {
    requests++
    return route.fulfill({ json: intelligence })
  })
  await page.goto('/')
  await expect(page.locator('.live-status-badge')).toHaveText('Sources current')
  const records = await page.locator('.osint-list').allTextContents()
  const sourceCount = requests
  await page.getByRole('button', { name: 'Start simulation', exact: true }).click()
  await selectForPageReview(page, page.locator('.simulation-event-list li button').first())
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click()
  await page.getByRole('button', { name: 'Start simulation', exact: true }).click()
  await page.clock.fastForward(2600)
  await selectForPageReview(page, page.locator('.simulation-event-list li button').first())
  expect(await page.locator('.osint-list').allTextContents()).toEqual(records)
  expect(requests).toBe(sourceCount)
  await expect(page.locator('.signal-strip dt').nth(1)).toHaveText('3')
})

test('workspace instructions are actionable keyboard controls for incident, evidence and response', async ({ page }) => {
  await page.goto('/')
  const select = page.getByRole('button', { name: /Select (?:an )?incident/i })
  await select.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.queue-row[aria-pressed="true"]')).toBeFocused()
  const review = page.getByRole('button', { name: /Review evidence/i })
  await review.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('dialog.incident-workspace')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(review).toBeFocused()
  const response = page.getByRole('link', { name: /Open (?:its )?response/i })
  await response.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('dialog.incident-workspace')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(response).toBeFocused()
})
