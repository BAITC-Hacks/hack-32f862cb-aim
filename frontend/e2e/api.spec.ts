import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('optistock.mode')) localStorage.setItem('optistock.mode', 'demo')
  })
})

const datasetId = '11111111-1111-4111-8111-111111111111'
const planId = '22222222-2222-4222-8222-222222222222'
const itemId = '33333333-3333-4333-8333-333333333333'
const recommendationId = '44444444-4444-4444-8444-444444444444'
const orderId = '55555555-5555-4555-8555-555555555555'
const lineId = '66666666-6666-4666-8666-666666666666'
const jobId = '77777777-7777-4777-8777-777777777777'
const scenario = {
  lead_time_days: 30,
  review_days: 30,
  safety_days: 14,
  growth_percent: 0,
  remove_outliers: true,
  estimate_stockouts: true,
  use_seasonality: true,
  use_trend: true,
  supplier: null,
  category: null,
}

async function mockApi(page: Page, role = 'admin') {
  const mutations: { path: string; body: Record<string, unknown>; key: string }[] = []
  let order = {
    id: orderId,
    plan_id: planId,
    supplier: 'iek',
    status: 'draft',
    revision: 1,
    created_at: '2026-09-23T08:00:00Z',
    arrival_date: '2026-10-22',
    lines: [
      {
        id: lineId,
        item_id: itemId,
        code: 'REAL-001',
        name: 'Connected circuit breaker',
        unit: 'pcs',
        recommended_quantity: '30.0000',
        quantity: '30.0000',
        reason: null as string | null,
      },
    ],
  }
  let imported = false
  const item = {
    id: itemId,
    code: 'REAL-001',
    name: 'Connected circuit breaker',
    supplier: 'iek',
    category: '1',
    unit: 'pcs',
    available: null,
    minimum: '10.0000',
    multiple: '10.0000',
  }
  let planned = true
  const requests: string[] = []
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace('/api/v1', '')
    requests.push(path)
    expect(request.headers().authorization).toBe('Bearer test-key')
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (request.method() !== 'GET') {
      const key = request.headers()['idempotency-key']
      expect(key).toMatch(/^[a-f0-9-]{36}$/)
      const body = request.headers()['content-type']?.includes('application/json')
        ? request.postDataJSON()
        : {}
      mutations.push({ path, body, key })
      if (path === '/datasets/sample') {
        imported = true
        planned = false
        return json({ dataset_id: datasetId, job_id: jobId }, 202)
      }
      if (path === '/plans') {
        planned = true
        return json({ plan_id: planId, job_id: jobId }, 202)
      }
      if (path === '/orders') return json({ order_ids: [orderId] }, 201)
      if (path === `/orders/${orderId}`) {
        const changed = body.lines[0]
        expect(body.revision).toBe(order.revision)
        order = {
          ...order,
          revision: order.revision + 1,
          lines: [{ ...order.lines[0], quantity: changed.quantity, reason: changed.reason }],
        }
        return json({ order_id: orderId, revision: order.revision, status: order.status })
      }
      if (path === `/orders/${orderId}/approve`) {
        expect(body.revision).toBe(order.revision)
        order = { ...order, status: 'approved', revision: order.revision + 1 }
        return json({ order_id: orderId, revision: order.revision, status: order.status })
      }
      return json({})
    }
    if (path === '/me') return json({ id: 'user-1', name: 'Connected User', role })
    if (path === '/datasets')
      return json({
        items: [
          {
            id: datasetId,
            status: 'ready',
            created_at: '2026-09-23T08:00:00Z',
            as_of: '2026-09-22',
            summary: { items: 1, files: imported ? 12 : 6 },
          },
        ],
      })
    if (path === '/plans')
      return json({
        items: planned
          ? [
              {
                id: planId,
                dataset_id: datasetId,
                status: 'ready',
                created_at: '2026-09-23T08:00:00Z',
                parameters: scenario,
                summary: { items: 1 },
              },
            ]
          : [],
      })
    if (path === '/orders') return json({ items: [{ ...order, lines: undefined }] })
    if (path === '/audit') return json({ items: [] })
    if (path === '/items') return json({ total: 1, items: [item] })
    if (path === `/plans/${planId}/recommendations`)
      return json({
        total: 1,
        items: [
          {
            id: recommendationId,
            item_id: itemId,
            quantity: '30.0000',
            risk: 'critical',
            warnings: ['current_inventory_is_assumed'],
            reason: 'Assumed inventory. Review sources.',
          },
        ],
      })
    if (path === `/recommendations/${recommendationId}`)
      return json({
        explanation: {
          inventory: 0,
          daily_base: 1,
          annual_trend_ratio: 1,
          forecast_quantity: 60,
          safety_stock: 14,
          raw_order_quantity: 29,
          order_quantity: '30',
          purchase_quantity: '30',
          pre_arrival_lost_sales: 29,
          inventory_source: 'assumed_zero',
          text: 'Assumed inventory. Review sources.',
          warnings: ['current_inventory_is_assumed'],
          rounding: { minimum: '10', multiple: '10', conversion: '1' },
          cleaned_monthly_sales: [{ month: '2026-08-01', quantity: 31 }],
          raw_monthly_sales: [{ month: '2026-08-01', quantity: 100 }],
          daily_projection: [{ date: '2026-09-23', demand: 1, incoming: 0, balance_without_new_order: -1 }],
          outlier_exclusions: [
            {
              date: '2026-08-14',
              document: 'PROJECT-123',
              original: 79,
              removed: 69,
              method: 'document_log_mad',
            },
          ],
          sources: {},
        },
      })
    if (path === `/orders/${orderId}`) return json(order)
    if (path === `/orders/${orderId}/export`)
      return route.fulfill({ contentType: 'text/csv', body: 'SKU;Quantity\nREAL-001;40\n' })
    if (path === `/jobs/${jobId}`)
      return json({ id: jobId, kind: 'plan', status: 'succeeded', progress: { stage: 'done' }, error: null })
    return json({ message: `Unexpected endpoint ${path}` }, 404)
  })
  await page.goto('/settings')
  await page.getByLabel('API access key', { exact: false }).fill('test-key')
  await page.getByRole('button', { name: 'Connect workspace', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Connected User', exact: true })).toBeVisible()
  return { mutations, requests }
}

test('live API mapping, unknown stock, forecast, order revisions and export', async ({ page }) => {
  const { mutations } = await mockApi(page)
  await page.getByRole('link', { name: 'Inventory', exact: true }).click()
  await expect(page.getByRole('button', { name: 'REAL-001', exact: true })).toBeVisible()
  await expect(page.locator('tbody tr').first()).toContainText('—')
  await expect(page.getByText('A120', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'REAL-001', exact: true }).click()
  await expect(page.getByRole('dialog').getByText('Assumed inventory. Review sources.')).toBeVisible()
  await expect(page.getByRole('dialog').getByText('Source sales', { exact: true })).toBeVisible()
  await expect(page.getByRole('row', { name: '2026-08 100 31 -69' })).toBeVisible()
  await expect(page.getByRole('dialog').getByText('PROJECT-123', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await page.getByRole('link', { name: 'Forecast', exact: true }).click()
  await page.getByRole('button', { name: 'Run analysis', exact: true }).click()
  await expect(page.getByText('Analysis complete. Recommendations are ready.')).toBeVisible()
  expect(mutations.find((m) => m.path === '/plans')?.body).toMatchObject({ dataset_id: datasetId, scenario })
  await page.getByRole('link', { name: /^Orders/ }).click()
  await page.getByRole('button', { name: 'Create from forecast', exact: true }).click()
  await page.getByRole('button', { name: 'PO-55555555', exact: true }).click()
  const modal = page.getByRole('dialog')
  await modal.getByRole('spinbutton').fill('40')
  await modal
    .getByRole('textbox', { name: 'Reason for changing quantities' })
    .fill('Confirmed customer demand')
  await modal.getByRole('button', { name: 'Save 1 changes' }).click()
  await expect(modal.getByText('v2', { exact: true })).toBeVisible()
  await modal.getByRole('button', { name: 'Approve order', exact: true }).click()
  await expect(modal.getByText('Approved', { exact: true })).toBeVisible()
  const download = page.waitForEvent('download')
  await modal.getByRole('button', { name: 'Export CSV' }).click()
  expect((await download).suggestedFilename()).toContain('r3.csv')
  expect(mutations.map((m) => m.key).length).toBe(new Set(mutations.map((m) => m.key)).size)
})

test('viewer permissions restrict mutations', async ({ page }) => {
  await mockApi(page, 'viewer')
  await page.getByRole('link', { name: 'Inventory', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Import inventory', exact: true })).toBeDisabled()
  await page.getByRole('link', { name: /^Orders/ }).click()
  await expect(page.getByRole('button', { name: 'Create from forecast', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'PO-55555555', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Approve order', exact: true })).toBeDisabled()
  await expect(page.getByRole('dialog').getByRole('spinbutton')).toHaveCount(0)
})

test('sample import polls a job and invalid keys show an error', async ({ page }) => {
  const { mutations, requests } = await mockApi(page)
  await page.getByRole('link', { name: 'Inventory', exact: true }).click()
  await page.getByRole('button', { name: 'Import inventory', exact: true }).click()
  await page.getByRole('button', { name: 'Load samples', exact: true }).click()
  await expect(page.getByText('Dataset imported. Your inventory is ready.')).toBeVisible()
  expect(mutations.find((m) => m.path === '/datasets/sample')?.body).toEqual({ as_of: '2026-09-22' })
  expect(requests).toContain(`/jobs/${jobId}`)
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Connected User', exact: true })).toBeVisible()
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'unauthorized', message: 'Invalid API key' }),
    }),
  )
  await page.getByLabel('API access key', { exact: false }).fill('bad-key')
  await page.getByRole('button', { name: 'Update connection', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Invalid API key')
})

test('retry after an ambiguous server failure reuses the idempotency key', async ({ page }) => {
  await mockApi(page)
  const keys: string[] = []
  await page.route('**/api/v1/plans', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    keys.push(route.request().headers()['idempotency-key'])
    if (keys.length === 1)
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Storage temporarily unavailable. Retry the request.' }),
      })
    return route.fallback()
  })
  await page.getByRole('link', { name: 'Forecast', exact: true }).click()
  await page.getByRole('button', { name: 'Run analysis', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Storage temporarily unavailable')
  await page.getByRole('button', { name: 'Run analysis', exact: true }).click()
  await expect(page.getByText('Analysis complete. Recommendations are ready.')).toBeVisible()
  expect(keys).toHaveLength(2)
  expect(keys[0]).toBe(keys[1])
})

test('reconnecting with the same key preserves a usable workspace', async ({ page }) => {
  await mockApi(page)
  await page.getByLabel('API access key', { exact: false }).fill('test-key')
  await page.getByRole('button', { name: 'Update connection', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Workspace connection', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Inventory', exact: true }).click()
  await expect(page.getByRole('button', { name: 'REAL-001', exact: true })).toBeVisible()
})

test('catalog pagination loads products beyond the first 200 records', async ({ page }) => {
  await mockApi(page)
  const offsets: number[] = []
  await page.route('**/api/v1/items?**', (route) => {
    const offset = Number(new URL(route.request().url()).searchParams.get('offset'))
    offsets.push(offset)
    const count = Math.min(200, 205 - offset)
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        total: 205,
        items: Array.from({ length: count }, (_, i) => ({
          id: `live-${offset + i}`,
          code: `REAL-${offset + i}`,
          name: `Live product ${offset + i}`,
          supplier: 'iek',
          category: '1',
          unit: 'pcs',
          available: '12',
          minimum: '1',
          multiple: '1',
        })),
      }),
    })
  })
  await page.reload()
  await page.getByRole('link', { name: 'Inventory', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search products', exact: true }).fill('REAL-204')
  await expect(page.getByRole('button', { name: 'REAL-204', exact: true })).toBeVisible()
  expect(offsets).toContain(200)
  await expect(page.locator('tbody tr')).toContainText('No forecast')
})
