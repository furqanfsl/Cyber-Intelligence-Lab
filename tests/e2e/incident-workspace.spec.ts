import { expect, test, type Page } from '@playwright/test'
import { createDemoIncident, type DemoIncident } from '../../src/lib/demo-scenarios.ts'
import type { ArtifactTab } from '../../src/data/scenarios.ts'
import { readDemoSession } from './demo-helpers.ts'
import { intelligence } from './fixtures.ts'

test.beforeEach(async ({ page }) => {
  await page.clock.install()
  await page.route('**/api/live-intel', (route) => route.fulfill({ json: intelligence }))
})

async function expectWorkspaceDossier(page: Page, incident: DemoIncident) {
  const workspace = page.locator('dialog.incident-workspace')
  await expect(workspace).toBeVisible()
  await expect(workspace).toHaveAttribute('data-incident-id', incident.id)
  await expect(workspace).toHaveAttribute('data-template-id', incident.templateId)
  await expect(workspace).toHaveAttribute('data-asset', incident.asset)
  await expect(workspace).toHaveAccessibleName(incident.title)
  await expect(workspace.locator('#workspace-title')).toHaveText(incident.title)
  await expect(workspace.locator('.workspace-evidence > .workspace-facts dd')).toHaveText([
    incident.asset, incident.region, `${incident.time} · demo time`, incident.actor, incident.vector, incident.technique,
  ])
  await expect(workspace.locator('[aria-labelledby="workspace-indicators-title"] dd')).toHaveText(incident.details.indicators.map(([, value]) => value))
  await expect(workspace.locator('.workspace-summary')).toHaveText(incident.details.summary)
  await expect(workspace.locator('.workspace-actions li > span:nth-child(2)')).toHaveText(incident.details.actions.map((action) => action.label))
  await expect(workspace.locator('.workspace-timeline time')).toHaveText(incident.details.timeline.map((step) => step.time))
  await expect(workspace.locator('.workspace-timeline p')).toHaveText(incident.details.timeline.map((step) => step.copy))
  await expect(workspace.locator('[aria-labelledby="workspace-containment-title"] li > span:last-child')).toHaveText(incident.details.containment.map((step) => step.label))
  await expect(workspace.locator('#workspace-disclaimer')).toContainText('No real systems are monitored or changed')
  for (const tab of ['file', 'network', 'process', 'registry'] as ArtifactTab[]) {
    const artifact = incident.details.artifacts[tab]
    await workspace.getByRole('tab', { name: artifact.label, exact: true }).click()
    const panel = workspace.getByRole('tabpanel')
    await expect(panel).toHaveAttribute('aria-labelledby', `workspace-tab-${tab}`)
    await expect(panel.locator('dt')).toHaveText(artifact.fields.map(([label]) => label))
    await expect(panel.locator('dd')).toHaveText(artifact.fields.map(([, value]) => value))
    await expect(panel.locator('li > span:last-child')).toHaveText(artifact.checklist.map(([label]) => label))
  }
}

test('queue investigations show matching complete evidence and response without carrying over a previous case', async ({ page }) => {
  await page.goto('/')
  const session = await readDemoSession(page)
  const ransomware = session.initialIncidents.find((incident) => incident.templateId === 'A78-4319')!
  const cloud = session.initialIncidents.find((incident) => incident.templateId === 'E09-7742')!
  for (const incident of [ransomware, cloud]) {
    const row = page.locator(`.queue-row[data-incident-id="${incident.id}"]`)
    await row.click()
    await expectWorkspaceDossier(page, incident)
    if (incident === cloud) {
      await expect(page.locator('dialog')).not.toContainText(ransomware.id)
      await expect(page.locator('dialog')).not.toContainText(ransomware.asset)
      await expect(page.locator('dialog')).not.toContainText('DemoUpdater')
    }
    await page.getByRole('button', { name: 'Close investigation', exact: true }).click()
    await expect(row).toBeFocused()
  }
})

test('generated activity opens its own randomized dossier inside the investigation', async ({ page }) => {
  await page.goto('/')
  const session = await readDemoSession(page)
  await page.getByRole('button', { name: 'Start simulation', exact: true }).click()
  await page.clock.fastForward(2600)
  const row = page.locator('.simulation-event-list li[data-batch="2"] button')
  await row.click()
  await expectWorkspaceDossier(page, createDemoIncident(session.seed, 2))
  await page.keyboard.press('Escape')
  await expect(row).toBeFocused()
})

test('investigation traps keyboard focus, blocks background focus and restores its opener on Escape', async ({ page }) => {
  await page.goto('/')
  const row = page.locator('.queue-row').first()
  await row.focus()
  await page.keyboard.press('Enter')
  const workspace = page.locator('dialog.incident-workspace')
  await expect(workspace).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close investigation', exact: true })).toBeFocused()
  expect(await workspace.evaluate((dialog) => dialog.matches(':modal'))).toBe(true)
  const focusInside = () => workspace.evaluate((dialog) => dialog.contains(document.activeElement))
  for (const direction of ['Tab', 'Shift+Tab']) {
    for (let index = 0; index < 12; index++) {
      await page.keyboard.press(direction)
      expect(await focusInside()).toBe(true)
    }
  }
  await page.locator('.simulation-toggle').evaluate((element) => element.focus())
  expect(await focusInside()).toBe(true)
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden')
  await page.keyboard.press('Escape')
  await expect(workspace).not.toBeVisible()
  await expect(row).toBeFocused()
  expect(await page.locator('body').evaluate((element) => element.style.overflow)).toBe('')
})

test('investigation artifact tabs support arrows and Home/End without affecting the background viewer', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Network', exact: true }).click()
  await page.locator('.queue-row').first().click()
  const workspace = page.locator('dialog.incident-workspace')
  const file = workspace.getByRole('tab', { name: 'File', exact: true })
  await file.click()
  await page.keyboard.press('ArrowRight')
  await expect(workspace.getByRole('tab', { name: 'Network', exact: true })).toBeFocused()
  await expect(workspace.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'workspace-tab-network')
  await page.keyboard.press('End')
  await expect(workspace.getByRole('tab', { name: 'Registry', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Home')
  await expect(file).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(workspace.getByRole('tab', { name: 'Registry', exact: true })).toBeFocused()
  await expect(workspace.locator('[role="tab"][tabindex="0"]')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.locator('#artifact-tab-network')).toHaveAttribute('aria-selected', 'true')
})

test('review pauses generation and closing the investigation never silently resumes it', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Start simulation', exact: true }).click()
  await page.locator('.simulation-event-list li button').first().click()
  await expect(page.locator('.simulation-console')).toHaveAttribute('data-state', 'paused')
  await page.clock.fastForward(26_000)
  await expect(page.locator('.simulation-session-count')).toHaveText('+7')
  await page.keyboard.press('Escape')
  await page.clock.fastForward(26_000)
  await expect(page.locator('.simulation-session-count')).toHaveText('+7')
  await page.getByRole('button', { name: 'Resume simulation', exact: true }).click()
  await expect(page.locator('.simulation-session-count')).toHaveText('+7')
  await page.clock.fastForward(2600)
  await expect(page.locator('.simulation-session-count')).toHaveText('+14')
})

test('evidence and response align side by side on desktop and stack without clipping at 320px', async ({ page }) => {
  await page.goto('/')
  await page.locator('.queue-row').first().click()
  const workspace = page.locator('dialog.incident-workspace')
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 })
    const dialog = await workspace.boundingBox()
    const evidence = await workspace.locator('.workspace-evidence').boundingBox()
    const response = await workspace.locator('.workspace-response').boundingBox()
    expect(dialog!.x).toBeGreaterThanOrEqual(0)
    expect(dialog!.x + dialog!.width).toBeLessThanOrEqual(width)
    expect(dialog!.y).toBeGreaterThanOrEqual(0)
    expect(dialog!.y + dialog!.height).toBeLessThanOrEqual(900)
    if (width === 1440) {
      expect(response!.x).toBeGreaterThanOrEqual(evidence!.x + evidence!.width - 1)
      expect(Math.abs(response!.y - evidence!.y)).toBeLessThanOrEqual(1)
    } else {
      expect(response!.y).toBeGreaterThanOrEqual(evidence!.y + evidence!.height - 1)
      expect(Math.abs(response!.x - evidence!.x)).toBeLessThanOrEqual(1)
    }
    expect(await workspace.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await workspace.locator('.workspace-response').scrollIntoViewIfNeeded()
    const close = page.getByRole('button', { name: 'Close investigation', exact: true })
    await expect(close).toBeInViewport()
    expect((await close.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
})

test('reduced-motion investigation opens without animation and backdrop dismissal restores focus', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  const row = page.locator('.queue-row').first()
  await row.click()
  const workspace = page.locator('dialog.incident-workspace')
  await expect(workspace).toHaveCSS('animation-name', 'none')
  expect(await workspace.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0)
  const bounds = await workspace.boundingBox()
  await page.mouse.click(Math.max(1, bounds!.x - 4), Math.max(1, bounds!.y - 4))
  await expect(workspace).not.toBeVisible()
  await expect(row).toBeFocused()
})

test('mobile investigation section controls jump directly between evidence and response without losing Close', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto('/')
  await page.locator('.queue-row').first().click()
  const workspace = page.locator('dialog.incident-workspace')
  for (const [name, paneName] of [['Response plan', 'response'], ['Evidence', 'evidence']] as const) {
    const control = workspace.getByRole('button', { name, exact: true })
    await control.focus()
    await page.keyboard.press('Enter')
    const pane = workspace.locator(`#workspace-${paneName}-pane`)
    await expect(pane).toBeFocused()
    await expect(pane.locator('h3')).toBeInViewport()
    const body = await workspace.locator('.workspace-body').boundingBox()
    const heading = await pane.locator('h3').boundingBox()
    expect(heading!.y).toBeGreaterThanOrEqual(body!.y)
    expect(heading!.y + heading!.height).toBeLessThanOrEqual(body!.y + body!.height)
    await expect(workspace.getByRole('button', { name: 'Close investigation', exact: true })).toBeInViewport()
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
})

test('normal motion uses brief modal fades and closing restores focus after the exit finishes', async ({ page }) => {
  // Freeze before navigation; the browser's controlled clock may run ahead of wall time.
  await page.clock.pauseAt(new Date(Date.now() + 60_000))
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  const row = page.locator('.queue-row').first()
  await row.click()
  const workspace = page.locator('dialog.incident-workspace')
  await expect(workspace).toHaveCSS('animation-name', 'workspace-open')
  await expect(workspace).toHaveCSS('animation-duration', '0.18s')
  await expect(workspace.locator('.workspace-evidence')).toHaveCSS('animation-name', 'workspace-pane-left')
  await expect(workspace.locator('.workspace-response')).toHaveCSS('animation-name', 'workspace-pane-right')
  await workspace.getByRole('button', { name: 'Close investigation', exact: true }).click()
  await expect(workspace).toHaveAttribute('data-closing', 'true')
  await expect(workspace).toHaveCSS('animation-name', 'workspace-depart')
  await page.clock.fastForward(180)
  await expect(workspace).not.toBeVisible()
  await expect(row).toBeFocused()
})
