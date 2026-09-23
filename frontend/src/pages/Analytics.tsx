import { useState } from 'react'
import { Activity, ArrowRight, Box, Download, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useWorkspace } from '../store'
import { useShell } from '../components/Layout'
import { csvBlob, downloadBlob, formatNumber, supplierName } from '../lib/format'
import { Button, EmptyState, PageHeader, Panel } from '../components/ui'
import { CategoryChart, InventoryDonut, StockBars } from '../components/charts'
import { MetricCard } from '../components/MetricCard'

export function Analytics() {
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
        ['Metric', 'Value', 'Supplier scope'],
        ['Products', products.length, supplier || 'All'],
        ['Healthy', healthy, supplier || 'All'],
        ['Critical', critical, supplier || 'All'],
        ['Data warnings', warnings.length, supplier || 'All'],
      ]),
      'optistock-analytics.csv',
    )
    ws.notify('Analytics summary exported.')
  }
  return (
    <div className="page">
      <PageHeader
        eyebrow="Intelligence / Analytics"
        title="The bigger picture, made clear."
        description="Understand inventory health, product coverage and the quality of your planning data."
        action={
          <>
            <select
              aria-label="Analytics supplier"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
            >
              <option value="">All suppliers</option>
              {[...new Set(ws.products.map((p) => p.supplier))].map((s) => (
                <option value={s} key={s}>
                  {supplierName(s)}
                </option>
              ))}
            </select>
            <Button icon={Download} onClick={exportSummary}>
              Export summary
            </Button>
          </>
        }
      />
      <div className="metrics-grid analytics-metrics">
        <MetricCard
          label="Products in scope"
          value={products.length}
          icon={Box}
          description="in the current dataset"
        />
        <MetricCard
          label="Inventory health"
          value={`${Math.round((healthy / (products.length || 1)) * 100)}%`}
          icon={ShieldCheck}
          tone="success"
          description={`${formatNumber(healthy)} healthy products`}
        />
        <MetricCard
          label="Critical stock"
          value={critical}
          icon={TriangleAlert}
          tone="danger"
          description="projected shortage before arrival"
        />
        <MetricCard
          label="Data warnings"
          value={warnings.length}
          icon={Activity}
          tone="blue"
          description="products with assumptions to review"
        />
      </div>
      <div className="analytics-grid">
        <Panel title="Inventory health distribution">
          <InventoryDonut products={products} />
        </Panel>
        <Panel title="Products by category">
          <CategoryChart products={products} />
        </Panel>
        <Panel title={ws.mode === 'demo' ? 'Warehouse coverage' : 'Supplier coverage'}>
          <StockBars products={products} group={ws.mode === 'demo' ? 'warehouse' : 'supplier'} />
        </Panel>
        <Panel title="Planning readiness">
          <div className="readiness-list">
            {[
              {
                label: 'Forecast available',
                count: products.filter((p) => p.recommendationId && p.risk !== 'insufficient_data').length,
                tone: 'green',
              },
              {
                label: 'Current stock known',
                count: products.filter((p) => p.available != null).length,
                tone: 'blue',
              },
              {
                label: 'Order constraints provided',
                count: products.filter((p) => p.minimum != null && p.multiple != null).length,
                tone: 'purple',
              },
              {
                label: 'No data warnings',
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
        title="Data quality & assumptions"
        action={<span className="badge badge-reorder">{warnings.length} products</span>}
      >
        <p className="panel-description">
          Review the inputs that can affect purchase decisions. Missing data is never counted as healthy
          stock.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th>Supplier</th>
                <th>Warnings</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {warnings.slice(0, showAll ? warnings.length : 6).map((p) => (
                <tr key={p.id}>
                  <td>{p.code}</td>
                  <td>{p.name}</td>
                  <td>{supplierName(p.supplier)}</td>
                  <td className="warning-cell">{p.warnings.join(', ').replaceAll('_', ' ')}</td>
                  <td>
                    <button className="text-link" onClick={() => showProduct(p)}>
                      Review <ArrowRight size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!warnings.length && (
          <EmptyState
            title="No data warnings in this selection"
            description="Review individual recommendations to inspect their source data and calculation."
          />
        )}
        {warnings.length > 6 && (
          <div className="table-footer">
            <span>
              {showAll ? warnings.length : 6} of {warnings.length} products
            </span>
            <Button onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show fewer' : 'Show all warnings'}
            </Button>
          </div>
        )}
      </Panel>
    </div>
  )
}
