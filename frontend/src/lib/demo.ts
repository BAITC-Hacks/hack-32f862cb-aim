import type { Explanation, Order, Product, Scenario, Snapshot } from '../types'

export const defaultScenario: Scenario = {
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
const catalog = [
  ['A120', 'Cable 3×2.5', 'ABB', 'Cables', 'Almaty', 20, 180, 240, 'critical'],
  ['B510', 'Circuit Breaker 16A', 'EKF', 'Protection', 'Astana', 43, 120, 90, 'reorder'],
  ['C404', 'Distribution Box', 'iek', 'Enclosures', 'Shymkent', 0, 85, 120, 'critical'],
  ['D221', 'Socket 220V', 'systeme', 'Wiring accessories', 'Almaty', 310, 90, 0, 'covered'],
  ['E331', 'DIN Rail 1m', 'ABB', 'Accessories', 'Karaganda', 12, 60, 60, 'reorder'],
  ['F602', 'LED Panel 36W', 'iek', 'Lighting', 'Atyrau', 420, 140, 0, 'covered'],
  ['G714', 'Contactor 25A', 'systeme', 'Protection', 'Astana', 165, 55, 0, 'covered'],
  ['H812', 'Cable Duct 40×25', 'EKF', 'Cables', 'Karaganda', 520, 160, 0, 'covered'],
  ['J903', 'Junction Box IP65', 'iek', 'Enclosures', 'Shymkent', 280, 80, 0, 'covered'],
  ['K104', 'Switch 1-gang', 'systeme', 'Wiring accessories', 'Almaty', 360, 110, 0, 'covered'],
] as const

export function demoProducts(): Product[] {
  return Array.from({ length: 1284 }, (_, i) => {
    const [code, name, supplier, category, warehouse, stock, forecast, recommended, risk] =
      catalog[i % catalog.length]
    const kind = i < 10 ? risk : i < 26 ? 'critical' : i < 237 ? 'reorder' : 'covered'
    return {
      id: `demo-${i}`,
      code: i < 10 ? code : `${code}-${String(Math.floor(i / 10)).padStart(3, '0')}`,
      name: i < 10 ? name : `${name} · ${['Standard', 'Pro', 'Compact'][i % 3]}`,
      supplier,
      category,
      warehouse,
      unit: category === 'Cables' ? 'm' : 'pcs',
      available:
        i < 10
          ? stock
          : kind === 'critical'
            ? i % 12
            : kind === 'reorder'
              ? 20 + (i % 60)
              : 200 + ((i * 37) % 600),
      forecast: i < 10 ? forecast : 40 + ((i * 11) % 190),
      recommended:
        i < 10 ? recommended : kind === 'covered' ? 0 : Math.ceil((80 + ((i * 7) % 220)) / 10) * 10,
      risk: kind,
      minimum: 10,
      multiple: 10,
      recommendationId: `rec-demo-${i}`,
      warnings: i % 197 === 0 ? ['unusual_demand_in_history'] : [],
    }
  })
}

export function demoExplanation(product: Product): Explanation {
  const index = Number(product.id.replace('demo-', '')) || 0
  const series = [100, 138, 167, 160, 215, 200, 235, 183, 168, 202, 184, 214]
  return {
    inventory: product.available ?? 0,
    daily_base: (product.forecast ?? 0) / 60,
    annual_trend_ratio: 1.08,
    forecast_quantity: product.forecast ?? 0,
    safety_stock: Math.ceil(((product.forecast ?? 0) * 14) / 60),
    raw_order_quantity: Math.max(0, (product.recommended ?? 0) - 4),
    order_quantity: String(product.recommended ?? 0),
    purchase_quantity: String(product.recommended ?? 0),
    pre_arrival_lost_sales: product.risk === 'critical' ? 24 : 0,
    inventory_source: 'Demo inventory snapshot',
    text: 'Illustrative recommendation based on demand, available stock, safety coverage and order multiples. Demo values are separate from your connected workspace.',
    warnings: product.warnings,
    rounding: { minimum: '10', multiple: '10', conversion: '1' },
    cleaned_monthly_sales: series.map((q, i) => ({
      month: `${i < 3 ? '2025' : '2026'}-${String(((i + 9) % 12) + 1).padStart(2, '0')}-01`,
      quantity: Math.round(q * (1 + (index % 5) * 0.12)),
    })),
    daily_projection: Array.from({ length: 60 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 8, 23 + i)).toISOString().slice(0, 10),
      demand: (product.forecast ?? 0) / 60,
      incoming: 0,
      balance_without_new_order: (product.available ?? 0) - ((i + 1) * (product.forecast ?? 0)) / 60,
    })),
    outlier_exclusions: product.warnings.length
      ? [{ date: '2026-04-12', document: 'DEMO-001', original: 550, removed: 350, method: 'illustrative' }]
      : [],
    sources: { dataset: 'Illustrative demo data' },
  }
}

export function createDemoSnapshot(): Snapshot {
  const products = demoProducts()
  const orders: Order[] = ['iek', 'systeme', 'ABB', 'EKF'].map((supplier, i) => ({
    id: `PO-${1032 - i}`,
    plan_id: 'demo-previous-plan',
    supplier,
    status: i < 2 ? 'draft' : 'approved',
    revision: 1,
    arrival_date: '2026-10-22',
    created_at: `2026-09-${23 - i}T08:30:00Z`,
    lines: products
      .filter((p) => p.supplier === supplier && (p.recommended ?? 0) > 0)
      .slice(0, 4)
      .map((p) => ({
        id: `line-${p.id}`,
        item_id: p.id,
        code: p.code,
        name: p.name,
        unit: p.unit,
        recommended_quantity: String(p.recommended),
        quantity: String(p.recommended),
        reason: null,
      })),
  }))
  return {
    products,
    orders,
    datasetId: 'demo-dataset',
    planId: 'demo-plan',
    datasets: [
      {
        id: 'demo-dataset',
        as_of: '2026-09-22',
        status: 'ready',
        created_at: '2026-09-22T08:00:00Z',
        summary: { items: products.length, files: 12 },
      },
    ],
    plans: [
      {
        id: 'demo-plan',
        dataset_id: 'demo-dataset',
        status: 'ready',
        created_at: '2026-09-23T08:00:00Z',
        parameters: defaultScenario,
        summary: { items: products.length },
      },
    ],
    events: [
      {
        id: 'event-1',
        action: 'order.draft',
        entity_id: 'PO-1032',
        created_at: '2026-09-23T08:40:00Z',
        details: { supplier: 'iek' },
      },
      {
        id: 'event-2',
        action: 'plan.create',
        entity_id: 'demo-plan',
        created_at: '2026-09-23T08:00:00Z',
        details: {},
      },
      {
        id: 'event-3',
        action: 'order.approve',
        entity_id: 'PO-1030',
        created_at: '2026-09-22T14:20:00Z',
        details: { revision: 2 },
      },
      {
        id: 'event-4',
        action: 'dataset.import',
        entity_id: 'demo-dataset',
        created_at: '2026-09-22T08:00:00Z',
        details: { file_count: 12 },
      },
    ],
  }
}
