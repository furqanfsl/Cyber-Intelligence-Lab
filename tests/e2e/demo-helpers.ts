import { expect, type Locator, type Page } from '@playwright/test'
import { createDemoSession, type DemoIncident } from '../../src/lib/demo-scenarios.ts'
import type { ArtifactTab } from '../../src/data/scenarios.ts'

/** Reconstruct the visible exercise ID; no test-only seed or browser hooks. */
export async function readDemoSession(page: Page) {
  const id = await page.locator('.simulation-console').getAttribute('data-session-id')
  expect(id).toMatch(/^[0-9A-F]{8}$/)
  return createDemoSession(Number.parseInt(id!, 16))
}

/** Legacy page-dossier checks close the new focused investigation before background actions. */
export async function selectForPageReview(page: Page, row: Locator) {
  const id = await row.getAttribute('data-incident-id')
  await row.click()
  const workspace = page.locator('dialog.incident-workspace')
  await expect(workspace).toBeVisible()
  await expect(workspace).toHaveAttribute('data-incident-id', id!)
  await page.getByRole('button', { name: 'Close investigation', exact: true }).click()
  await expect(workspace).not.toBeVisible()
}

export async function expectCompleteDossier(page: Page, incident: DemoIncident) {
  const scenario = incident.details
  await expect(page.locator('.alert-panel')).toHaveAttribute('data-incident-id', incident.id)
  await expect(page.locator('.alert-panel')).toHaveAttribute('data-template-id', incident.templateId)
  await expect(page.locator('.alert-panel')).toHaveAttribute('data-asset', incident.asset)
  await expect(page.locator('.alert-panel .panel-heading')).toContainText(incident.id)
  await expect(page.locator('.alert-panel h3')).toHaveText(incident.title)
  await expect(page.locator('.alert-panel .severity-badge')).toHaveText(incident.severity.toUpperCase())
  await expect(page.locator('#response')).toHaveAttribute('data-incident-id', incident.id)
  await expect(page.locator('#response')).toHaveAttribute('data-template-id', incident.templateId)
  await expect(page.locator('#response')).toHaveAttribute('data-asset', incident.asset)
  await expect(page.locator('.risk-grid > div').nth(0).locator('strong')).toHaveText(String(scenario.riskScore))
  await expect(page.locator('.risk-grid > div').nth(1).locator('strong')).toHaveText(incident.title)
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
}
