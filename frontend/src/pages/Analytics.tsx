import { t, useLanguage } from '../i18n'
import { useState } from 'react'
import { Activity, ArrowRight, Box, Download, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useWorkspace } from '../store'
import { useShell } from '../components/Layout'
import { csvBlob, downloadBlob, formatNumber, supplierName } from '../lib/format'
import { Button, EmptyState, PageHeader, Panel } from '../components/ui'
import { CategoryChart, InventoryDonut, StockBars } from '../components/charts'
import { MetricCard } from '../components/MetricCard'

export function Analytics() {
  useLanguage()
  const ws = useWorkspace()
  const { showProduct } = useShell()
  const [supplier, setSupplier] = useState('')
  const products = ws.products.filter((p) => !supplier || p.supplier === supplier)
  const warnings = products.filter((p) => p.warnings.length)
  const [showAll, setShowAll] = useState(false)
  const critical = products.filter((p) => p.risk === 'critical').length
  const healthy = products.filter((p) => p.risk === 'covered').length
  function exportSummary() {
    downloadBlob(
      csvBlob([
        [t('Metric'), t('Value'), t('Supplier scope')],
        [t('Products'), products.length, supplier || t('All')],
        [t('Healthy'), healthy, supplier || t('All')],
        [t('Critical'), critical, supplier || t('All')],
        [t('Data warnings'), warnings.length, supplier || t('All')],
      ]),
      'optistock-analytics.csv',
    )
    ws.notify(t('Analytics summary exported.'))
  }
  return (
    <div className="page">
      <PageHeader
        eyebrow={t('Intelligence / Analytics')}
        title={t('The bigger picture, made clear.')}
        description={t(
          'Understand inventory health, product coverage and the quality of your planning data.',
        )}
        action={
          <>
            <select
              aria-label={t('Analytics supplier')}
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
            >
              <option value="">{t('All suppliers')}</option>
              {[...new Set(ws.products.map((p) => p.supplier))].map((s) => (
                <option value={s} key={s}>
                  {supplierName(s)}
                </option>
              ))}
            </select>
            <Button icon={Download} onClick={exportSummary}>
              {t('Export summary')}
            </Button>
          </>
        }
      />
      <div className="metrics-grid analytics-metrics">
        <MetricCard
          label={t('Products in scope')}
          value={products.length}
          icon={Box}
          description={t('in the current dataset')}
        />
        <MetricCard
          label={t('Inventory health')}
          value={`${Math.round((healthy / (products.length || 1)) * 100)}%`}
          icon={ShieldCheck}
          tone="success"
          description={t`${formatNumber(healthy)} healthy products`}
        />
        <MetricCard
          label={t('Critical stock')}
          value={critical}
          icon={TriangleAlert}
          tone="danger"
          description={t('projected shortage before arrival')}
        />
        <MetricCard
          label={t('Data warnings')}
          value={warnings.length}
          icon={Activity}
          tone="blue"
          description={t('products with assumptions to review')}
        />
      </div>
      <div className="analytics-grid">
        <Panel title={t('Inventory health distribution')}>
          <InventoryDonut products={products} />
        </Panel>
        <Panel title={t('Products by category')}>
          <CategoryChart products={products} />
        </Panel>
        <Panel title={ws.mode === 'demo' ? t('Warehouse coverage') : t('Supplier coverage')}>
          <StockBars products={products} group={ws.mode === 'demo' ? 'warehouse' : 'supplier'} />
        </Panel>
        <Panel title={t('Planning readiness')}>
          <div className="readiness-list">
            {[
              {
                label: t('Forecast available'),
                count: products.filter((p) => p.recommendationId && p.risk !== 'insufficient_data').length,
                tone: 'green',
              },
              {
                label: t('Current stock known'),
                count: products.filter((p) => p.available != null).length,
                tone: 'blue',
              },
              {
                label: t('Order constraints provided'),
                count: products.filter((p) => p.minimum != null && p.multiple != null).length,
                tone: 'purple',
              },
              {
                label: t('No data warnings'),
                count: products.filter((p) => !p.warnings.length).length,
                tone: 'green',
              },
            ].map((r) => (
              <div key={r.label}>
                <div>
                  <span>{r.label}</span>
                  <strong>
                    {formatNumber(r.count)} / {formatNumber(products.length)}
                  </strong>
                </div>
                <div className={`readiness-track ${r.tone}`}>
                  <i style={{ width: `${(r.count / (products.length || 1)) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <Panel
        title={t('Data quality & assumptions')}
        action={
          <span className="badge badge-reorder">
            {warnings.length} {t('products')}
          </span>
        }
      >
        <p className="panel-description">
          {t(
            'Review the inputs that can affect purchase decisions. Missing data is never counted as healthy stock.',
          )}
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>{t('Product')}</th>
                <th>{t('Supplier')}</th>
                <th>{t('Warnings')}</th>
                <th>{t('Action')}</th>
              </tr>
            </thead>
            <tbody>
              {warnings.slice(0, showAll ? warnings.length : 6).map((p) => (
                <tr key={p.id}>
                  <td>{p.code}</td>
                  <td>{p.name}</td>
                  <td>{supplierName(p.supplier)}</td>
                  <td className="warning-cell">{p.warnings.map((warning) => t(warning)).join(', ')}</td>
                  <td>
                    <button className="text-link" onClick={() => showProduct(p)}>
                      {t('Review')} <ArrowRight size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!warnings.length && (
          <EmptyState
            title={t('No data warnings in this selection')}
            description={t('Review individual recommendations to inspect their source data and calculation.')}
          />
        )}
        {warnings.length > 6 && (
          <div className="table-footer">
            <span>
              {showAll ? warnings.length : 6} {t('of')} {warnings.length} {t('products')}
            </span>
            <Button onClick={() => setShowAll((v) => !v)}>
              {showAll ? t('Show fewer') : t('Show all warnings')}
            </Button>
          </div>
        )}
      </Panel>
    </div>
  )
}
