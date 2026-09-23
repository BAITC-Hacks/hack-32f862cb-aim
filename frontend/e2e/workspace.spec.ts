import { test, expect } from '@playwright/test'

test('dashboard, search and accessible product drawer', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Good afternoon, Aigerim' })).toBeVisible()
  await expect(page.getByText('1,284', { exact: true }).first()).toBeVisible()
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true })
  await page.getByRole('textbox', { name: 'Global search' }).fill('A120')
  await page.getByRole('textbox', { name: 'Global search' }).press('Enter')
  const drawer = page.getByRole('dialog', { name: 'Product details' })
  await expect(drawer).toBeVisible()
  await expect(drawer.getByText('Final recommendation')).toBeVisible()
  await expect(drawer.getByText('240 m', { exact: true }).first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(drawer).not.toBeVisible()
  expect(errors).toEqual([])
})

test('inventory filtering, pagination and CSV selection', async ({ page }) => {
  await page.goto('/inventory')
  await page.getByRole('button', { name: /^Critical \(/ }).click()
  await expect(page.locator('tbody tr')).toHaveCount(12)
  await page.getByRole('button', { name: 'Next page', exact: true }).click()
  await expect(page.locator('.table-footer')).toContainText('Showing 13')
  await page.getByRole('textbox', { name: 'Search products', exact: true }).fill('C404')
  await expect(page.locator('tbody tr')).toHaveCount(3)
  await page.getByRole('checkbox', { name: 'Select C404', exact: true }).check()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export (1)', exact: true }).click()
  expect((await download).suggestedFilename()).toBe('optistock-inventory.csv')
  await page.getByRole('textbox', { name: 'Search products', exact: true }).fill('nonexistent item')
  await expect(page.getByRole('heading', { name: 'No products found' })).toBeVisible()
})

test('order quantity validation, revision, approval, export and persistence', async ({ page }) => {
  await page.goto('/orders')
  await page.getByRole('button', { name: 'PO-1032', exact: true }).click()
  const modal = page.getByRole('dialog')
  const quantity = modal.getByRole('spinbutton').first()
  await quantity.fill('130')
  await modal
    .getByRole('textbox', { name: 'Reason for changing quantities' })
    .fill('Confirmed project requirement')
  await modal.getByRole('button', { name: 'Save 1 changes' }).click()
  await expect(modal.getByText('v2', { exact: true })).toBeVisible()
  await modal.getByRole('button', { name: 'Approve order', exact: true }).click()
  await expect(modal.getByText('Approved', { exact: true })).toBeVisible()
  await expect(modal.getByText('v3', { exact: true })).toBeVisible()
  const download = page.waitForEvent('download')
  await modal.getByRole('button', { name: 'Export CSV' }).click()
  expect((await download).suggestedFilename()).toContain('r3.csv')
  await page.reload()
  await page.getByRole('button', { name: 'PO-1032', exact: true }).click()
  await expect(page.getByRole('dialog').getByText('Approved', { exact: true })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel order', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm cancellation' }).click()
  await expect(page.getByRole('dialog').getByText('Cancelled', { exact: true })).toBeVisible()
})

test('scenario recalculation produces supplier drafts', async ({ page }) => {
  await page.goto('/forecast')
  await page.getByRole('spinbutton', { name: 'Expected demand growth' }).fill('50')
  await page.getByRole('button', { name: 'Run analysis', exact: true }).click()
  await expect(page.getByText('Demo scenario updated. Recommendations recalculated.')).toBeVisible()
  await page.getByRole('link', { name: /^Orders/ }).click()
  await page.getByRole('button', { name: 'Create from forecast', exact: true }).click()
  await expect(page.getByText('4 supplier orders created.')).toBeVisible()
  await expect(page.locator('tbody tr')).toHaveCount(8)
  await page.getByRole('button', { name: 'Create from forecast', exact: true }).click()
  await expect(page.getByText('Drafts for this plan already exist.')).toBeVisible()
  await expect(page.locator('tbody tr')).toHaveCount(8)
})

test('all routes render and reports download', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  for (const [path, title] of [
    ['/suppliers', 'Stronger supply connections.'],
    ['/analytics', 'The bigger picture, made clear.'],
    ['/reports', 'Good decisions leave a trail.'],
    ['/settings', 'A workspace that works for you.'],
  ]) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: title })).toBeVisible()
  }
  await page.goto('/reports')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download', exact: true }).first().click()
  expect((await download).suggestedFilename()).toBe('optistock-inventory.csv')
  expect(errors).toEqual([])
})

test('mobile navigation, layout and product drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Good afternoon, Aigerim' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const banner = await page.locator('.intelligence-banner').boundingBox()
  expect(banner!.height).toBeLessThan(250)
  await expect(page.getByRole('heading', { name: 'AI Insights' })).toBeVisible()
  await page.screenshot({ path: 'test-results/dashboard-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('link', { name: 'Inventory', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your inventory, in focus.' })).toBeVisible()
  await page.getByRole('button', { name: 'A120', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
})

test('demo import sends users to connection settings', async ({ page }) => {
  await page.goto('/inventory')
  await page.getByRole('button', { name: 'Import inventory', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Connect your workspace' })).toBeVisible()
  await page.getByRole('button', { name: 'Open connection settings' }).click()
  await expect(page).toHaveURL(/\/settings$/)
  await expect(page.getByLabel('API access key', { exact: false })).toBeVisible()
})

test('all pages fit mobile and tablet viewports', async ({ page }) => {
  for (const width of [390, 1024]) {
    await page.setViewportSize({ width, height: 900 })
    for (const path of [
      '/inventory',
      '/suppliers',
      '/orders',
      '/forecast',
      '/analytics',
      '/reports',
      '/settings',
    ]) {
      await page.goto(path)
      await expect(page.locator('main h1')).toBeVisible()
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `${path} at ${width}px`,
      ).toBe(true)
    }
  }
})
