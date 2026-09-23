import { useState } from 'react'
import {
  ArrowRight,
  CalendarDays,
  CircleHelp,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useWorkspace } from '../store'
import { defaultScenario } from '../lib/demo'
import { formatNumber } from '../lib/format'
import { useExplanation } from '../lib/useExplanation'
import { useShell } from '../components/Layout'
import { Badge, Button, InlineError, PageHeader, Panel, Toggle } from '../components/ui'
import { DemandChart } from '../components/charts'
import type { Scenario } from '../types'

export function Forecast() {
  const ws = useWorkspace()
  const { showProduct } = useShell()
  const navigate = useNavigate()
  const [scenario, setScenario] = useState<Scenario>(ws.scenario)
  const [productId, setProductId] = useState(ws.products[0]?.id || '')
  const product = ws.products.find((p) => p.id === productId) ?? ws.products[0]
  const { explanation, error } = useExplanation(product)
  const update = <K extends keyof Scenario>(key: K, value: Scenario[K]) =>
    setScenario((s) => ({ ...s, [key]: value }))
  async function run() {
    try {
      await ws.runPlan(scenario)
    } catch {
      /* Error toast preserves the edited scenario. */
    }
  }
  return (
    <div className="page">
      <PageHeader
        eyebrow="Intelligence / Forecast"
        title="See what's coming next."
        description="Turn demand signals into explainable, actionable purchase recommendations."
        action={
          <span className="forecast-method">
            <span className="connection-dot live" />
            {ws.mode === 'demo' ? 'Interactive demo scenario' : 'Robust seasonal model'}
          </span>
        }
      />
      <div className="forecast-layout">
        <div className="forecast-main">
          <Panel
            title="Demand & forecast"
            action={
              <select
                className="product-select"
                aria-label="Forecast product"
                value={product?.id ?? ''}
                onChange={(e) => setProductId(e.target.value)}
              >
                {ws.products.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.code} · {p.name}
                  </option>
                ))}
              </select>
            }
          >
            <div className="forecast-chart-heading">
              <div>
                <span className="muted">Forecast demand</span>
                <strong>
                  {formatNumber(explanation?.forecast_quantity)} <small>{product?.unit || 'units'}</small>
                </strong>
              </div>
              {product && <Badge status={product.risk} />}
            </div>
            {error && <InlineError message={error} />}
            <DemandChart explanation={explanation} demo={ws.mode === 'demo'} large months={12} />
            <p className="chart-footnote">
              {ws.mode === 'demo'
                ? 'Illustrative sales and forecast. Scenario changes update demand and order quantities.'
                : 'Cleaned monthly sales followed by monthly totals of the daily forecast. Boundary months may be partial.'}
            </p>
          </Panel>
          <div className="forecast-metrics">
            <Panel>
              <CalendarDays size={19} />
              <span>Lead time</span>
              <strong>
                {ws.scenario.lead_time_days} <small>days</small>
              </strong>
            </Panel>
            <Panel>
              <ShieldCheck size={19} />
              <span>Safety coverage</span>
              <strong>
                {ws.scenario.safety_days} <small>days</small>
              </strong>
            </Panel>
            <Panel>
              <Sparkles size={19} />
              <span>Recommended order</span>
              <strong>
                {formatNumber(product?.recommended)} <small>{product?.unit}</small>
              </strong>
            </Panel>
          </div>
          <Panel title="Recommended next steps">
            <div className="next-step">
              <span className="step-number">01</span>
              <div>
                <strong>Review products that need replenishment</strong>
                <p>
                  {ws.products.filter((p) => (p.recommended ?? 0) > 0).length} products have a positive
                  recommended order quantity.
                </p>
              </div>
              <Button onClick={() => navigate('/inventory?risk=reorder')}>
                View inventory
                <ArrowRight size={14} />
              </Button>
            </div>
            <div className="next-step">
              <span className="step-number">02</span>
              <div>
                <strong>Understand the calculation</strong>
                <p>Review demand, stock, order multiples and assumptions for each product.</p>
              </div>
              <Button disabled={!product} onClick={() => product && showProduct(product)}>
                View breakdown
              </Button>
            </div>
            <div className="next-step">
              <span className="step-number">03</span>
              <div>
                <strong>Build your next supplier orders</strong>
                <p>Create drafts from the active forecast, then review quantities before approval.</p>
              </div>
              <Button onClick={() => navigate('/orders')}>
                Open orders
                <ArrowRight size={14} />
              </Button>
            </div>
          </Panel>
        </div>
        <Panel title="Scenario settings" action={<SlidersHorizontal size={17} />} className="scenario-panel">
          <p className="panel-description">Adjust the assumptions behind your next purchase.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void run()
            }}
          >
            <div className="scenario-numbers">
              {[
                {
                  key: 'lead_time_days' as const,
                  label: 'Supplier lead time',
                  min: 1,
                  max: 180,
                  unit: 'days',
                },
                { key: 'review_days' as const, label: 'Review period', min: 1, max: 90, unit: 'days' },
                {
                  key: 'safety_days' as const,
                  label: 'Safety stock coverage',
                  min: 0,
                  max: 90,
                  unit: 'days',
                },
                {
                  key: 'growth_percent' as const,
                  label: 'Expected demand growth',
                  min: -50,
                  max: 200,
                  unit: '%',
                },
              ].map((f) => (
                <label key={f.key}>
                  {f.label}
                  <div className="input-with-unit">
                    <input
                      required
                      type="number"
                      step={f.key === 'growth_percent' ? '.1' : '1'}
                      min={f.min}
                      max={f.max}
                      value={scenario[f.key]}
                      onChange={(e) => update(f.key, Number(e.target.value))}
                    />
                    <span>{f.unit}</span>
                  </div>
                </label>
              ))}
            </div>
            <label>
              Supplier scope
              <select
                value={scenario.supplier ?? ''}
                onChange={(e) => update('supplier', e.target.value || null)}
              >
                <option value="">All suppliers</option>
                {[...new Set(ws.products.map((p) => p.supplier))].map((s) => (
                  <option key={s} value={s}>
                    {s === 'iek' ? 'IEK' : s === 'systeme' ? 'Systeme Electric' : s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Category scope
              <select
                value={scenario.category ?? ''}
                onChange={(e) => update('category', e.target.value || null)}
              >
                <option value="">All categories</option>
                {[...new Set(ws.products.map((p) => p.category).filter((x): x is string => !!x))].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <div className="scenario-toggles">
              <Toggle
                label="Seasonality"
                description="Use the supplier seasonal profile"
                checked={scenario.use_seasonality}
                onChange={(v) => update('use_seasonality', v)}
              />
              <Toggle
                label="Demand trend"
                description="Use consistent year-on-year changes"
                checked={scenario.use_trend}
                onChange={(v) => update('use_trend', v)}
              />
              <Toggle
                label="Exclude unusual orders"
                description="Reduce one-off demand distortion"
                checked={scenario.remove_outliers}
                onChange={(v) => update('remove_outliers', v)}
              />
              <Toggle
                label="Estimate stockouts"
                description="Compensate for zero-stock periods"
                checked={scenario.estimate_stockouts}
                onChange={(v) => update('estimate_stockouts', v)}
              />
            </div>
            <div className="scenario-note">
              <CircleHelp size={15} />
              <p>
                {ws.mode === 'demo'
                  ? 'Demo calculation uses coverage and growth inputs. Advanced switches are applied by the connected backend.'
                  : 'Forecasts use the dataset snapshot date. Missing inventory and sales are handled using saved model assumptions.'}
              </p>
            </div>
            <Button
              type="submit"
              variant="primary"
              icon={Sparkles}
              loading={ws.busy}
              disabled={!ws.canPlan || !ws.datasetId}
              className="full-width"
            >
              Run analysis
            </Button>
            <Button
              type="button"
              variant="ghost"
              icon={RotateCcw}
              onClick={() => setScenario(defaultScenario)}
              disabled={ws.busy}
              className="full-width"
            >
              Reset to defaults
            </Button>
          </form>
        </Panel>
      </div>
    </div>
  )
}
