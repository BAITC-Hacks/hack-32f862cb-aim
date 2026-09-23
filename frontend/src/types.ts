export type Risk = 'critical' | 'reorder' | 'covered' | 'insufficient_data'
export type Role = 'viewer' | 'planner' | 'approver' | 'admin'
export interface User {
  id: string
  name: string
  role: Role
}
export interface Product {
  id: string
  code: string
  name: string
  supplier: string
  unit: string
  category: string | null
  available: number | null
  warehouse?: string
  minimum: number | null
  multiple: number | null
  risk: Risk
  recommended: number | null
  forecast: number | null
  recommendationId?: string
  warnings: string[]
  reason?: string
}
export interface Scenario {
  lead_time_days: number
  review_days: number
  safety_days: number
  growth_percent: number
  remove_outliers: boolean
  estimate_stockouts: boolean
  use_seasonality: boolean
  use_trend: boolean
  supplier: string | null
  category: string | null
}
export interface Dataset {
  id: string
  as_of: string
  status: string
  created_at: string
  summary: { items?: number; files?: number; by_supplier?: Record<string, number>; limitations?: string[] }
}
export interface Plan {
  id: string
  dataset_id: string
  status: string
  created_at: string
  parameters: Scenario
  summary: { items?: number; reorder_items?: number; critical_items?: number; unforecastable_items?: number }
}
export interface Recommendation {
  id: string
  item_id: string
  quantity: string
  risk: Risk
  warnings: string[]
  reason: string
}
export interface Explanation {
  inventory: number
  daily_base: number
  annual_trend_ratio: number
  forecast_quantity: number
  safety_stock: number
  raw_order_quantity: number
  order_quantity: string
  purchase_quantity: string
  pre_arrival_lost_sales: number
  inventory_source: string
  text: string
  warnings: string[]
  rounding: { minimum: string; multiple: string; conversion: string }
  cleaned_monthly_sales: { month: string; quantity: number }[]
  raw_monthly_sales?: { month: string; quantity: number | null }[]
  daily_projection: { date: string; demand: number; incoming: number; balance_without_new_order: number }[]
  outlier_exclusions: { date: string; document: string; original: number; removed: number; method: string }[]
  stockout_adjustments?: { month: string; added: number; method: string }[]
  sources: Record<string, unknown>
}
export interface OrderLine {
  id: string
  item_id: string
  code: string
  name: string
  unit: string
  recommended_quantity: string
  quantity: string
  reason: string | null
}
export interface Order {
  id: string
  plan_id: string
  supplier: string
  status: 'draft' | 'approved' | 'cancelled'
  revision: number
  arrival_date: string
  created_at: string
  lines?: OrderLine[]
}
export interface AuditEvent {
  id: string
  action: string
  entity_id: string
  created_at: string
  details: Record<string, unknown>
}
export interface Job {
  id: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  kind: string
  progress: { stage?: string; processed?: number; total?: number; items?: number }
  error: { message?: string; code?: string } | null
}
export interface Snapshot {
  products: Product[]
  datasets: Dataset[]
  plans: Plan[]
  orders: Order[]
  events: AuditEvent[]
  datasetId: string
  planId: string
}

export interface AgentRun {
  id: string
  plan_id: string
  dataset_id: string
  created_at: string
  finished_at: string | null
  status: Job['status']
  job: Job
  scenario: Scenario
  report: Partial<{
    engine: string
    decision: string
    quality: {
      items: number
      with_history: number
      without_history: number
      with_current_inventory: number
      with_incoming: number
      with_transactions: number
      with_category: number
      as_of: string
    }
    summary: {
      items: number
      order_lines: number
      critical_items: number
      excluded_documents: number
      outlier_corrections?: number
      outlier_items: number
      stockout_items: number
      exception_items: number
    }
    steps: { key: string; title: string; detail: string }[]
    suppliers: {
      supplier: string
      items: number
      order_lines: number
      critical: number
      quantities: Record<string, number>
    }[]
    exceptions: {
      item_id: string
      recommendation_id: string
      code: string
      name: string
      supplier: string
      risk: Risk
      reasons: string[]
    }[]
    exceptions_total: number
    outlier_comparisons: {
      item_id: string
      code: string
      supplier: string
      unit: string
      without_cleaning: string
      with_cleaning: string
      documents: number
    }[]
    warnings: { code: string; items: number }[]
    order_ids: string[]
    limitations: string[]
  }>
}
