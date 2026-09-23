import { test, expect } from '@playwright/test'
import type { ScenarioId } from '../../src/data/scenarios.ts'
import { expectCompleteDossier, readDemoSession, selectForPageReview } from './demo-helpers.ts'
import { intelligence } from './fixtures.ts'

const families: ScenarioId[] = ['A78-4319', 'B16-9012', 'C93-1204', 'D44-6059', 'E09-7742']

test.beforeEach(async ({ page }) => {
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: intelligence }))
})

for (const templateId of families) {
  test(`${templateId} updates its complete randomized response dossier rather than just the title`, async ({ page }) => {
    await page.goto('/')
    const session = await readDemoSession(page)
    const incident = session.initialIncidents.find((item) => item.templateId === templateId)!
    const other = session.initialIncidents.find((item) => item.templateId !== templateId)!
    // Always exercise a selection transition, regardless of randomized initial selection.
    await selectForPageReview(page, page.locator(`.queue-row[data-incident-id="${other.id}"]`))
    await selectForPageReview(page, page.locator(`.queue-row[data-incident-id="${incident.id}"]`))
    await expectCompleteDossier(page, incident)
  })
}

test('switching from ransomware to cloud policy never leaves ransomware evidence in the active tab', async ({ page }) => {
  await page.goto('/')
  const session = await readDemoSession(page)
  const ransomware = session.initialIncidents.find((item) => item.templateId === 'A78-4319')!
  const cloud = session.initialIncidents.find((item) => item.templateId === 'E09-7742')!
  await selectForPageReview(page, page.locator(`.queue-row[data-incident-id="${ransomware.id}"]`))
  await page.getByRole('tab', { name: 'Registry', exact: true }).click()
  await expect(page.getByRole('tabpanel')).toContainText('DemoUpdater')
  await selectForPageReview(page, page.locator(`.queue-row[data-incident-id="${cloud.id}"]`))
  await expect(page.getByRole('tab', { name: 'Registry', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel')).toContainText('Not applicable: managed cloud storage')
  for (const tab of ['File', 'Network', 'Process', 'Registry']) {
    await page.getByRole('tab', { name: tab, exact: true }).click()
    await expect(page.locator('#response')).not.toContainText(/WINWORD|DemoUpdater|Lateral movement|Confidence high/)
    await expect(page.locator('#response')).not.toContainText(ransomware.asset)
    await expect(page.locator('#response')).not.toContainText(ransomware.id)
  }
  await expect(page.locator('.scenario-summary')).toContainText('not evidence of data access')
})

test('every randomized queue severity has a visible word as well as a colored marker', async ({ page }) => {
  await page.goto('/')
  const session = await readDemoSession(page)
  const rows = page.locator('.queue-row')
  await expect(rows).toHaveCount(families.length)
  for (const incident of session.initialIncidents) {
    const row = page.locator(`.queue-row[data-incident-id="${incident.id}"]`)
    const label = row.locator('.queue-severity')
    await expect(label).toHaveText(incident.severity)
    await expect(label).toBeVisible()
    expect(await label.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(12)
    const dimensions = await label.boundingBox()
    expect(dimensions!.width).toBeGreaterThan(12)
    expect(dimensions!.height).toBeGreaterThan(10)
    await expect(row).toHaveAccessibleName(new RegExp(incident.severity))
  }
})
