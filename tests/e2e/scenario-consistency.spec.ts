import { test, expect, type Page } from '@playwright/test'
import { scenarioDetails, type ArtifactTab, type ScenarioId } from '../../src/data/scenarios.ts'
import { intelligence } from './fixtures.ts'

const incidents: Array<{ id: ScenarioId; title: string; severity: string }> = [
  { id: 'A78-4319', title: 'Ransomware activity detected', severity: 'critical' },
  { id: 'B16-9012', title: 'Multiple failed SSH attempts', severity: 'high' },
  { id: 'C93-1204', title: 'Command and control beacon', severity: 'high' },
  { id: 'D44-6059', title: 'Privilege escalation attempt', severity: 'medium' },
  { id: 'E09-7742', title: 'Policy violation on cloud bucket', severity: 'low' },
]

async function selectIncident(page: Page, title: string) {
  await page.locator('.queue-row').filter({ has: page.locator('strong', { hasText: title }) }).click()
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: intelligence }))
})

for (const incident of incidents) {
  test(`${incident.id} updates its complete response dossier rather than just the title`, async ({ page }) => {
    const scenario = scenarioDetails[incident.id]
    await page.goto('/')
    // Exercise a real selection transition even for the initially selected incident.
    if (incident.id === 'A78-4319') await selectIncident(page, incidents[4].title)
    await selectIncident(page, incident.title)
    await expect(page.locator('.alert-panel .panel-heading')).toContainText(incident.id)
    await expect(page.locator('.alert-panel .severity-badge')).toHaveText(incident.severity.toUpperCase())
    await expect(page.locator('.risk-grid > div').nth(0).locator('strong')).toHaveText(String(scenario.riskScore))
    await expect(page.locator('.risk-grid > div').nth(2).locator('strong')).toHaveText(scenario.phase)
    await expect(page.locator('.scenario-summary')).toHaveText(scenario.summary)
    await expect(page.locator('.related-iocs .ioc-row code')).toHaveText(scenario.indicators.map(([, value]) => value))
    await expect(page.locator('.containment-mini .checklist-item > span:last-child')).toHaveText(scenario.containment.map((step) => step.label))
    await expect(page.locator('.containment-mini .checklist-state')).toHaveText(scenario.containment.map((step) => step.done ? 'Done' : 'Pending'))
    await expect(page.locator('.timeline-item h3')).toHaveText(scenario.timeline.map((step) => step.stage))
    await expect(page.locator('.timeline-item time')).toHaveText(scenario.timeline.map((step) => step.time))
    await expect(page.locator('.timeline-item p')).toHaveText(scenario.timeline.map((step) => step.copy))
    await expect(page.locator('.technique-table code')).toHaveText(scenario.techniques.map(([id]) => id))
    await expect(page.locator('.actions-list p')).toHaveText(scenario.actions.map((action) => action.label))
    await expect(page.locator('.containment-strip')).toContainText(`${scenario.containment.filter((step) => step.done).length} of ${scenario.containment.length}`)

    for (const tab of Object.keys(scenario.artifacts) as ArtifactTab[]) {
      const artifact = scenario.artifacts[tab]
      await page.getByRole('tab', { name: artifact.label, exact: true }).click()
      const panel = page.getByRole('tabpanel')
      await expect(panel).toHaveAttribute('aria-labelledby', `artifact-tab-${tab}`)
      await expect(panel.locator('dt')).toHaveText(artifact.fields.map(([label]) => label))
      await expect(panel.locator('dd')).toHaveText(artifact.fields.map(([, value]) => value))
      await expect(panel.locator('.checklist-item > span:last-child')).toHaveText(artifact.checklist.map(([label]) => label))
      await expect(panel.locator('.checklist-state')).toHaveText(artifact.checklist.map(([, done]) => done ? 'Done' : 'Pending'))
    }
  })
}

test('switching from ransomware to cloud policy never leaves ransomware evidence in the active tab', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Registry', exact: true }).click()
  await expect(page.getByRole('tabpanel')).toContainText('DemoUpdater')
  await selectIncident(page, 'Policy violation on cloud bucket')
  await expect(page.getByRole('tab', { name: 'Registry', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel')).toContainText('Not applicable: managed cloud storage')
  for (const tab of ['File', 'Network', 'Process', 'Registry']) {
    await page.getByRole('tab', { name: tab, exact: true }).click()
    await expect(page.locator('#response')).not.toContainText(/invoice_7784|WINWORD|DemoUpdater|Lateral movement|Confidence high/)
  }
  await expect(page.locator('.scenario-summary')).toContainText('not evidence of data access')
})

test('every queue severity has a visible word as well as a colored marker', async ({ page }) => {
  await page.goto('/')
  const rows = page.locator('.queue-row')
  await expect(rows).toHaveCount(incidents.length)
  for (let index = 0; index < incidents.length; index++) {
    const label = rows.nth(index).locator('.queue-severity')
    await expect(label).toHaveText(incidents[index].severity)
    await expect(label).toBeVisible()
    // The word is the non-color severity cue, so it must remain readable on mobile.
    expect(await label.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(12)
    const dimensions = await label.boundingBox()
    expect(dimensions!.width).toBeGreaterThan(12)
    expect(dimensions!.height).toBeGreaterThan(10)
    await expect(rows.nth(index)).toHaveAccessibleName(new RegExp(incidents[index].severity))
  }
})
