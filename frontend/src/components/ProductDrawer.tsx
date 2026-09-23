import { t, useLanguage } from '../i18n'
import { useEffect, useState } from 'react'
import { ArrowRight, Box, CircleAlert, FileText, PackageCheck, ShieldCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useWorkspace } from '../store'
import { errorMessage, formatNumber, supplierName } from '../lib/format'
import { explanationSummary, inventorySource } from '../i18n/domain'
import type { Explanation, Product } from '../types'
import { Badge, Button, Dialog, InlineError, Loading } from './ui'
import { DemandChart } from './charts'
import { DemandHistory } from './DemandHistory'
import { AssistantPanel } from './AssistantPanel'

export function ProductDrawer({ product, onClose }: { product: Product; onClose: () => void }) {
  useLanguage()
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
      title={t('Product details')}
      description={t('Understand the risk. Make the next move.')}
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
            {supplierName(product.supplier)} · {product.warehouse || t('Supplier aggregate')}
          </span>
        </div>
      </div>
      <div className="detail-status">
        <Badge status={product.risk} />
        <span>{product.category || t('Uncategorised')}</span>
      </div>
      <div className="detail-metrics">
        <div>
          <span>{t('Current stock')}</span>
          <strong>
            {formatNumber(product.available)} <small>{product.unit}</small>
          </strong>
        </div>
        <div>
          <span>{t('Recommended order')}</span>
          <strong className="text-accent">
            {formatNumber(product.recommended)} <small>{product.unit}</small>
          </strong>
        </div>
      </div>
      {loading ? (
        <Loading text={t('Loading recommendation...')} />
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
              {t('Recommendation breakdown')}
            </h3>
            <dl className="breakdown">
              {[
                [t('Forecast demand'), formatNumber(explanation.forecast_quantity)],
                [t('Safety stock'), formatNumber(explanation.safety_stock)],
                [t('Available inventory'), formatNumber(explanation.inventory)],
                [
                  t('Incoming during forecast'),
                  formatNumber(explanation.daily_projection.reduce((total, day) => total + day.incoming, 0)),
                ],
                [t('Annual trend'), `${formatNumber((explanation.annual_trend_ratio - 1) * 100)}%`],
                [t('Unrounded requirement'), formatNumber(explanation.raw_order_quantity)],
                [
                  t('Minimum / order multiple'),
                  `${explanation.rounding.minimum} / ${explanation.rounding.multiple}`,
                ],
                [t('Purchase unit conversion'), explanation.rounding.conversion],
                [t('Expected shortage before delivery'), formatNumber(explanation.pre_arrival_lost_sales)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
              <div className="breakdown-total">
                <dt>{t('Final recommendation')}</dt>
                <dd>
                  {formatNumber(explanation.order_quantity)} {product.unit}
                </dd>
              </div>
            </dl>
            <p className="detail-note">{explanationSummary(explanation, product.unit, ws.mode === 'demo')}</p>
          </div>
          <div className="detail-section">
            <h3>{t('Demand & forecast')}</h3>
            <DemandChart explanation={explanation} demo={ws.mode === 'demo'} months={6} />
          </div>
          <DemandHistory key={product.recommendationId} explanation={explanation} unit={product.unit} />
          {explanation.warnings.length > 0 && (
            <div className="warning-box">
              <CircleAlert size={17} />
              <div>
                <strong>{t('Review these assumptions')}</strong>
                <ul>
                  {explanation.warnings.map((w) => (
                    <li key={w}>{t(w)}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          <details className="source-details">
            <summary>
              <FileText size={15} />
              {t('Data sources & inventory basis')}
            </summary>
            <p>{inventorySource(explanation.inventory_source)}</p>
            <pre>{JSON.stringify(explanation.sources, null, 2)}</pre>
          </details>
        </>
      ) : (
        <div className="warning-box">
          <CircleAlert size={18} />
          <span>
            {t('No recommendation yet. Run an analysis for this dataset to calculate procurement needs.')}
          </span>
        </div>
      )}
      {ws.planId && explanation && (
        <AssistantPanel
          planId={ws.planId}
          itemId={product.id}
          itemCode={product.code}
          defaultTask="explain"
        />
      )}
      <div className="drawer-footer">
        <div className="small-note">
          <ShieldCheck size={15} />
          {t('Orders are reviewed before approval.')}
        </div>
        <Button
          variant="primary"
          icon={ArrowRight}
          onClick={() => {
            onClose()
            navigate(explanation ? '/orders' : '/forecast')
          }}
        >
          {explanation ? t('Review purchase orders') : t('Open forecast')}
        </Button>
      </div>
    </Dialog>
  )
}
