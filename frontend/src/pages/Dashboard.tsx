import { formatDateTime, t, useLanguage } from '../i18n'
import { useState } from 'react'
import {
  Activity,
  ArrowRight,
  Box,
  CalendarCheck2,
  ChartNoAxesCombined,
  Package,
  ShoppingCart,
  Sparkles,
  TriangleAlert,
  Truck,
  Zap,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useWorkspace } from '../store'
import { formatNumber } from '../lib/format'
import { useExplanation } from '../lib/useExplanation'
import { useShell } from '../components/Layout'
import { Badge, PageHeader, Panel, TextLink } from '../components/ui'
import { DemandChart, InventoryDonut, StockBars } from '../components/charts'
import { InventoryTable } from '../components/InventoryTable'
import { MetricCard } from '../components/MetricCard'

export function Dashboard() {
  useLanguage()
  const ws = useWorkspace()
  const { showProduct } = useShell()
  const navigate = useNavigate()
  const [months, setMonths] = useState(9)
  const [warehouse, setWarehouse] = useState('')
  const [allInsights, setAllInsights] = useState(false)
  const critical = ws.products.filter((p) => p.risk === 'critical')
  const atRisk = ws.products.filter((p) => p.risk === 'critical' || p.risk === 'reorder')
  const flagged = ws.products.filter((p) => p.warnings.length)
  const { explanation } = useExplanation(ws.products[0])
  const healthy = Math.round(
    (ws.products.filter((p) => p.risk === 'covered').length / (ws.products.length || 1)) * 100,
  )
  const topProducts = [
    ...critical.slice(0, 2),
    ...ws.products.filter((p) => p.risk === 'reorder').slice(0, 1),
    ...ws.products.filter((p) => p.risk === 'covered').slice(0, 1),
  ]
  const insights = [
    {
      icon: Package,
      tone: 'danger',
      title: (
        <>
          <em>{critical.length} SKU</em> {t('may run out before next supply')}
        </>
      ),
      subtitle: t('Review critical stock'),
      path: '/inventory?risk=critical',
    },
    {
      icon: TriangleAlert,
      tone: 'warning',
      title: (
        <>
          {t('Products needing replenishment:')} {formatNumber(atRisk.length)}
        </>
      ),
      subtitle: t('Review purchase recommendations'),
      path: '/forecast',
    },
    {
      icon: Activity,
      tone: 'purple',
      title: (
        <>
          {flagged.length} {t('products have data warnings')}
        </>
      ),
      subtitle: t('Review data quality & assumptions'),
      path: '/analytics',
    },
    {
      icon: Truck,
      tone: 'neutral',
      title: (
        <>
          {t('Supplier orders awaiting review:')} {ws.orders.filter((o) => o.status === 'draft').length}
        </>
      ),
      subtitle: t('Keep your next delivery on track'),
      path: '/orders',
    },
    {
      icon: ChartNoAxesCombined,
      tone: 'blue',
      title: (
        <>
          {healthy}
          {t('% of products have healthy stock')}
        </>
      ),
      subtitle: t('Explore your inventory health'),
      path: '/analytics',
    },
    {
      icon: Box,
      tone: 'neutral',
      title: (
        <>
          {t('Suppliers in your workspace:')} {new Set(ws.products.map((p) => p.supplier)).size}
        </>
      ),
      subtitle: t('View supplier coverage'),
      path: '/suppliers',
    },
  ]
  return (
    <div className="dashboard-layout">
      <div className="dashboard-primary">
        <PageHeader
          eyebrow={t('Dashboard')}
          title={
            <>
              {t('Good afternoon,')} {ws.user.name.split(' ')[0]} <span className="wave">👋</span>
            </>
          }
          description={t("Here's what's happening with your supply chain today.")}
        />
        <div className="metrics-grid">
          <MetricCard
            label={t('Total Products')}
            value={ws.products.length}
            icon={Box}
            tone="success"
            description={t('in your active dataset')}
            onClick={() => navigate('/inventory')}
          />
          <MetricCard
            label={t('At Risk')}
            value={atRisk.length}
            icon={TriangleAlert}
            tone="danger"
            description={t`${critical.length} need urgent attention`}
            onClick={() => navigate('/inventory?risk=critical')}
          />
          <MetricCard
            label={t('Purchase Orders')}
            value={ws.orders.length}
            icon={ShoppingCart}
            tone="success"
            description={t`${ws.orders.filter((o) => o.status === 'draft').length} awaiting review`}
            onClick={() => navigate('/orders')}
          />
          <MetricCard
            label={t('Data Warnings')}
            value={flagged.length}
            icon={Activity}
            tone="blue"
            description={t('products to review')}
            onClick={() => navigate('/analytics')}
          />
        </div>
        <div className="dashboard-chart-row">
          <Panel
            title={t('Inventory Overview')}
            action={<TextLink onClick={() => navigate('/analytics')}>{t('View details')}</TextLink>}
          >
            <InventoryDonut products={ws.products} />
          </Panel>
          <Panel
            title={t('Demand vs Forecast')}
            action={
              <select
                className="small-select"
                aria-label={t('Chart period')}
                value={months}
                onChange={(e) => setMonths(Number(e.target.value))}
              >
                <option value={6}>{t('Last 6 months')}</option>
                <option value={9}>{t('Last 9 months')}</option>
                <option value={12}>{t('Last 12 months')}</option>
              </select>
            }
          >
            <div className="chart-product-label">
              {ws.products[0]?.name ?? t('Select a dataset')}{' '}
              <span>· {ws.products[0]?.code || t('No data')}</span>
            </div>
            <DemandChart explanation={explanation} demo={ws.mode === 'demo'} months={months} />
          </Panel>
        </div>
        <div className="dashboard-middle-row">
          <Panel
            title={ws.mode === 'demo' ? t('Products by Warehouse') : t('Products by Supplier')}
            action={
              ws.mode === 'demo' ? (
                <select
                  className="small-select"
                  aria-label={t('Warehouse chart filter')}
                  value={warehouse}
                  onChange={(e) => setWarehouse(e.target.value)}
                >
                  <option value="">{t('All Warehouses')}</option>
                  {[...new Set(ws.products.map((p) => p.warehouse))].map((w) => (
                    <option key={w}>{w}</option>
                  ))}
                </select>
              ) : (
                <span className="muted text-small">{t('SKU distribution')}</span>
              )
            }
          >
            <StockBars
              products={warehouse ? ws.products.filter((p) => p.warehouse === warehouse) : ws.products}
              group={ws.mode === 'demo' ? 'warehouse' : 'supplier'}
            />
          </Panel>
          <Panel
            title={t('Recent Activity')}
            action={<TextLink onClick={() => navigate('/reports')}>{t('See all')}</TextLink>}
          >
            <div className="activity-list">
              {ws.events.slice(0, 4).map((event) => (
                <button
                  key={event.id}
                  onClick={() =>
                    navigate(
                      event.action.startsWith('order')
                        ? '/orders'
                        : event.action.startsWith('plan')
                          ? '/forecast'
                          : '/reports',
                    )
                  }
                >
                  <span className={`icon-tile ${event.action.includes('approve') ? 'success' : 'blue'}`}>
                    {event.action.startsWith('order') ? (
                      <CalendarCheck2 size={16} />
                    ) : event.action.startsWith('plan') ? (
                      <ChartNoAxesCombined size={16} />
                    ) : (
                      <Box size={16} />
                    )}
                  </span>
                  <span className="activity-title">
                    {{
                      'order.draft': t('New purchase order'),
                      'order.approve': t('Purchase order approved'),
                      'order.edit': t('Order quantities updated'),
                      'order.cancel': t('Order cancelled'),
                      'plan.create': t('Forecast updated'),
                      'dataset.import': t('Inventory imported'),
                    }[event.action] || t(event.action)}
                  </span>
                  <time>
                    {formatDateTime(new Date(event.created_at), {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </time>
                  <span
                    className={`badge ${event.action === 'order.cancel' ? 'badge-cancelled' : 'badge-covered'}`}
                  >
                    {event.action === 'order.draft'
                      ? t('Created')
                      : event.action === 'order.cancel'
                        ? t('Cancelled')
                        : t('Success')}
                  </span>
                </button>
              ))}
              {!ws.events.length && (
                <p className="muted empty-inline">{t('Your workspace activity will appear here.')}</p>
              )}
            </div>
          </Panel>
        </div>
        <InventoryTable compact onSelect={showProduct} />
        <div className="dashboard-bottom-note">
          <span className="connection-dot" />
          {ws.mode === 'demo'
            ? t('Exploring demo data. Connect your workspace to see live inventory.')
            : t('Inventory scope: consolidated supplier data. Forecasts use saved scenario assumptions.')}
          <button onClick={() => navigate('/settings')}>
            {ws.mode === 'demo' ? t('Connect workspace') : t('Manage connection')}
            <ArrowRight size={13} />
          </button>
        </div>
      </div>
      <aside className="dashboard-rail">
        <section className="intelligence-banner">
          <span className="banner-label">
            <Sparkles size={13} /> {t('INVENTORY INTELLIGENCE')}
          </span>
          <h2>
            {t('Smarter inventory')}
            <br />
            {t('for a bigger tomorrow.')}
          </h2>
          <button onClick={() => navigate('/agent')}>
            {t('Run AI Analysis')} <ArrowRight size={16} />
          </button>
        </section>
        <Panel
          title={t('AI Insights')}
          action={
            <TextLink onClick={() => setAllInsights((v) => !v)}>
              {allInsights ? t('Show less') : t`See all (${insights.length})`}
            </TextLink>
          }
        >
          <div className="insights-list">
            {insights.slice(0, allInsights ? 6 : 4).map(({ icon: Icon, tone, title, subtitle, path }, i) => (
              <button key={i} onClick={() => navigate(path)}>
                <span className={`icon-tile ${tone}`}>
                  <Icon size={18} />
                </span>
                <span>
                  <strong>{title}</strong>
                  <small>{subtitle}</small>
                </span>
              </button>
            ))}
          </div>
        </Panel>
        <Panel
          title={t('Top Products by Stock Risk')}
          action={<TextLink onClick={() => navigate('/inventory?risk=critical')}>{t('View all')}</TextLink>}
        >
          <div className="risk-products">
            {topProducts.map((p, i) => (
              <button key={p.id} onClick={() => showProduct(p)}>
                <span className={`product-thumbnail product-thumbnail-${i}`}>
                  <Box size={26} strokeWidth={1.2} />
                </span>
                <span className="risk-product-name">
                  {p.name}
                  <small>{p.code}</small>
                </span>
                <Badge status={p.risk} />
                <span className="stock-left">
                  {formatNumber(p.available)} {t('left')}
                </span>
              </button>
            ))}
            {!topProducts.length && (
              <p className="muted empty-inline">{t('Import inventory to see stock risks.')}</p>
            )}
          </div>
        </Panel>
        <Panel title={t('Inventory Health')}>
          <div className="health-card">
            <div className="health-visual">
              <div className="health-grid" />
              <svg viewBox="0 0 200 95" aria-hidden="true">
                <path
                  d={`M0 80 L25 80 L25 ${80 - healthy * 0.5} L65 ${80 - healthy * 0.5} L65 ${80 - healthy * 0.65} L105 ${80 - healthy * 0.65} L105 ${80 - healthy * 0.8} L150 ${80 - healthy * 0.8} L150 ${80 - healthy * 0.7} L200 ${80 - healthy * 0.7}`}
                  fill="none"
                  stroke="#939ba7"
                  strokeWidth="1.5"
                />
              </svg>
              <span>{t('Current coverage')}</span>
            </div>
            <div className="health-number">
              <strong>{healthy}%</strong>
              <span>{t('Overall Health')}</span>
              <small>
                <span className="connection-dot live" />
                {healthy >= 80 ? t('In good shape') : t('Needs attention')}
              </small>
            </div>
          </div>
        </Panel>
        <div className="rail-note">
          <Zap size={14} />
          <span>
            {ws.mode === 'demo'
              ? t('Demo insights · illustrative inventory')
              : t('Insights from your latest planning run')}
          </span>
        </div>
      </aside>
    </div>
  )
}
