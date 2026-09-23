import type { AgentRun, Explanation } from '../types'
import { formatNumber } from '../lib/format'
import { t } from './index'

// Render persisted numeric results in the UI language; never recalculate or mutate them.
export function explanationSummary(explanation: Explanation, unit: string, demo: boolean) {
  if (demo || !explanation.text.startsWith('Заказ ')) return t(explanation.text)
  return t(
    'Order {0} {1}; forecast {2}, safety stock {3}, initial stock {4}. Incoming goods are accounted for by date. Possible shortage before delivery: {5}. Calculation uses case data and saved assumptions.',
    formatNumber(explanation.order_quantity),
    unit,
    formatNumber(explanation.forecast_quantity),
    formatNumber(explanation.safety_stock),
    formatNumber(explanation.inventory),
    formatNumber(explanation.pre_arrival_lost_sales),
  )
}

export function inventorySource(source: string) {
  if (source.startsWith('snapshot_proxy:'))
    return t('Stock snapshot used as a proxy: {0}', source.slice('snapshot_proxy:'.length))
  return t(source)
}

export function agentStepDetail(
  step: { key: string; detail: string },
  report: AgentRun['report'] | undefined,
) {
  if (!report?.summary || !report.quality) return t(step.detail)
  const { summary, quality } = report
  if (step.key === 'validate')
    return t(
      'Sales history: {0} of {1} SKU. Current stock: {2} SKU.',
      formatNumber(quality.with_history),
      formatNumber(quality.items),
      formatNumber(quality.with_current_inventory),
    )
  if (step.key === 'clean')
    return t(
      'Unique documents adjusted: {0}; item adjustments: {1}; products with estimated lost demand: {2}.',
      formatNumber(summary.excluded_documents),
      formatNumber(summary.outlier_corrections),
      formatNumber(summary.stockout_items),
    )
  if (step.key === 'review')
    return t(
      'Needs attention: {0} SKU. Each recommendation includes a numeric explanation.',
      formatNumber(summary.exception_items),
    )
  return t(step.detail)
}
