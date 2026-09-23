import { expect, test } from '@playwright/test'

// Explicitly opt in: this test creates and reviews drafts in the local case-data workspace.
test.skip(!process.env.OPTISTOCK_LIVE_E2E, 'Requires local API, worker, PostgreSQL and imported case files')

test('real procurement agent, persisted run, source explanation, approval and CSV', async ({ page }) => {
  test.setTimeout(180000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    localStorage.setItem('optistock.mode', 'live')
    localStorage.setItem('optistock.language', 'en')
    localStorage.setItem('optistock.apiBase', '/api/v1')
    sessionStorage.setItem('optistock.token', 'local')
  })
  await page.goto('/agent')
  await expect(page.getByRole('button', { name: 'Run agent', exact: true })).toBeEnabled({
    timeout: 30000,
  })
  await page.getByRole('button', { name: 'Run agent', exact: true }).click()
  await expect(page.getByText('Calculation complete. Manager review is the next step.')).toBeVisible({
    timeout: 120000,
  })
  await expect(page.locator('.agent-supplier')).toHaveCount(2)
  await page.reload()
  await expect(page.locator('.agent-supplier')).toHaveCount(2, { timeout: 30000 })
  await page.screenshot({ path: 'test-results/agent-live-desktop.png', fullPage: true })
  await page.getByRole('tab', { name: 'Needs attention' }).click()
  await page.locator('.agent-exception:not([disabled])').first().click()
  await expect(page.getByRole('dialog').getByText('Final recommendation')).toBeVisible()
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await page.getByRole('tab', { name: 'One-off spikes' }).click()
  await page.locator('.agent-comparison').first().click()
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'How regular demand is calculated' }),
  ).toBeVisible()
  await expect(page.getByRole('dialog').locator('.history-table-scroll tbody tr')).toHaveCount(12)
  await expect(page.getByRole('dialog').locator('.history-corrections > div').first()).toBeVisible()
  await page
    .getByRole('dialog')
    .locator('.demand-history')
    .screenshot({ path: 'test-results/demand-history-live.png' })
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await page.getByRole('tab', { name: 'Orders', exact: true }).click()
  await page.getByRole('link', { name: 'Review order', exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('spinbutton').first()).toBeVisible()
  await dialog.getByRole('spinbutton').first().fill('0')
  await dialog
    .getByRole('textbox', { name: 'Reason for changing quantities' })
    .fill('Проверка полного сценария на тестовых данных кейса')
  await dialog.getByRole('button', { name: 'Save changes (1)' }).click()
  await expect(dialog.getByText('v2', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Approve order', exact: true }).click()
  await expect(dialog.getByText('Approved', { exact: true })).toBeVisible()
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Export CSV', exact: true }).click()
  expect((await download).suggestedFilename()).toMatch(/optistock-.*-r3\.csv/)
  // Release the test commitment. No supplier receives any message or order.
  await dialog.getByRole('button', { name: 'Cancel order', exact: true }).click()
  await dialog.getByRole('button', { name: 'Confirm cancellation', exact: true }).click()
  await expect(dialog.getByText('Cancelled', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await page.goto('/agent')
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(page.locator('.agent-supplier')).toHaveCount(2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/agent-live-${width}.png`, fullPage: true })
  }
  expect(errors).toEqual([])
})
