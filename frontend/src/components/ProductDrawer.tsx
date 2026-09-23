import { useEffect, useState } from 'react'
import { ArrowRight, Box, CircleAlert, FileText, PackageCheck, ShieldCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useWorkspace } from '../store'
import { errorMessage, formatNumber, supplierName } from '../lib/format'
import type { Explanation, Product } from '../types'
import { Badge, Button, Dialog, InlineError, Loading } from './ui'
import { DemandChart } from './charts'

export function ProductDrawer({ product, onClose }: { product: Product; onClose: () => void }) {
  const ws = useWorkspace()
  const navigate = useNavigate()
  const [explanation, setExplanation] = useState<Explanation | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    ws.getExplanation(product)
      .then((e) => {
        if (active) {
          setExplanation(e)
          setError('')
        }
      })
      .catch((e) => {
        if (active) setError(errorMessage(e))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
    // The product and API instance identify the immutable recommendation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product, ws.api, attempt])
  return (
    <Dialog
      title="Product details"
      description="Understand the risk. Make the next move."
      drawer
      onClose={onClose}
    >
      <div className="product-detail-heading">
        <div className="product-large-icon">
          <Box size={33} strokeWidth={1.3} />
        </div>
        <div>
          <span className="eyebrow">{product.code}</span>
          <h2>{product.name}</h2>
          <span className="muted">
            {supplierName(product.supplier)} · {product.warehouse || 'Supplier aggregate'}
          </span>
        </div>
      </div>
      <div className="detail-status">
        <Badge status={product.risk} />
        <span>{product.category || 'Uncategorised'}</span>
      </div>
      <div className="detail-metrics">
        <div>
          <span>Current stock</span>
          <strong>
            {formatNumber(product.available)} <small>{product.unit}</small>
          </strong>
        </div>
        <div>
          <span>Recommended order</span>
          <strong className="text-accent">
            {formatNumber(product.recommended)} <small>{product.unit}</small>
          </strong>
        </div>
      </div>
      {loading ? (
        <Loading text="Loading recommendation..." />
      ) : error ? (
        <InlineError
          message={error}
          retry={() => {
            setLoading(true)
            setAttempt((a) => a + 1)
          }}
        />
      ) : explanation ? (
        <>
          <div className="detail-section">
            <h3>
              <PackageCheck size={16} />
              Recommendation breakdown
            </h3>
            <dl className="breakdown">
              {[
                ['Forecast demand', formatNumber(explanation.forecast_quantity)],
                ['Safety stock', formatNumber(explanation.safety_stock)],
                ['Available inventory', formatNumber(explanation.inventory)],
                ['Annual trend', `${((explanation.annual_trend_ratio - 1) * 100).toFixed(1)}%`],
                ['Unrounded requirement', formatNumber(explanation.raw_order_quantity)],
                [
                  'Minimum / order multiple',
                  `${explanation.rounding.minimum} / ${explanation.rounding.multiple}`,
                ],
                ['Purchase unit conversion', explanation.rounding.conversion],
                ['Expected shortage before delivery', formatNumber(explanation.pre_arrival_lost_sales)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
              <div className="breakdown-total">
                <dt>Final recommendation</dt>
                <dd>
                  {formatNumber(explanation.order_quantity)} {product.unit}
                </dd>
              </div>
            </dl>
            <p className="detail-note">{explanation.text}</p>
          </div>
          <div className="detail-section">
            <h3>Demand & forecast</h3>
            <DemandChart explanation={explanation} demo={ws.mode === 'demo'} months={6} />
          </div>
          {explanation.warnings.length > 0 && (
            <div className="warning-box">
              <CircleAlert size={17} />
              <div>
                <strong>Review these assumptions</strong>
                <ul>
                  {explanation.warnings.map((w) => (
                    <li key={w}>{w.replaceAll('_', ' ')}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          <details className="source-details">
            <summary>
              <FileText size={15} />
              Data sources & inventory basis
            </summary>
            <p>{explanation.inventory_source.replaceAll('_', ' ')}</p>
            <pre>{JSON.stringify(explanation.sources, null, 2)}</pre>
          </details>
        </>
      ) : (
        <div className="warning-box">
          <CircleAlert size={18} />
          <span>No recommendation yet. Run an analysis for this dataset to calculate procurement needs.</span>
        </div>
      )}
      <div className="drawer-footer">
        <div className="small-note">
          <ShieldCheck size={15} />
          Orders are reviewed before approval.
        </div>
        <Button
          variant="primary"
          icon={ArrowRight}
          onClick={() => {
            onClose()
            navigate(explanation ? '/orders' : '/forecast')
          }}
        >
          {explanation ? 'Review purchase orders' : 'Open forecast'}
        </Button>
      </div>
    </Dialog>
  )
}
