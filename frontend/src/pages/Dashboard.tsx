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
          <em>{critical.length} SKU</em> may run out before next supply
        </>
      ),
      subtitle: 'Review critical stock',
      path: '/inventory?risk=critical',
    },
    {
      icon: TriangleAlert,
      tone: 'warning',
      title: <>{atRisk.length} products need replenishment</>,
      subtitle: 'Review purchase recommendations',
      path: '/forecast',
    },
    {
      icon: Activity,
      tone: 'purple',
      title: <>{flagged.length} products have data warnings</>,
      subtitle: 'Review data quality & assumptions',
      path: '/analytics',
    },
    {
      icon: Truck,
      tone: 'neutral',
      title: <>{ws.orders.filter((o) => o.status === 'draft').length} supplier orders awaiting review</>,
      subtitle: 'Keep your next delivery on track',
      path: '/orders',
    },
    {
      icon: ChartNoAxesCombined,
      tone: 'blue',
      title: <>{healthy}% of products have healthy stock</>,
      subtitle: 'Explore your inventory health',
      path: '/analytics',
    },
    {
      icon: Box,
      tone: 'neutral',
      title: <>{new Set(ws.products.map((p) => p.supplier)).size} suppliers in your workspace</>,
      subtitle: 'View supplier coverage',
      path: '/suppliers',
    },
  ]
  return (
    <div className="dashboard-layout">
      <div className="dashboard-primary">
        <PageHeader
          eyebrow="Dashboard"
          title={
            <>
              Good afternoon, {ws.user.name.split(' ')[0]} <span className="wave">👋</span>
            </>
          }
          description="Here's what's happening with your supply chain today."
        />
        <div className="metrics-grid">
          <MetricCard
            label="Total Products"
            value={ws.products.length}
            icon={Box}
            tone="success"
            description="in your active dataset"
            onClick={() => navigate('/inventory')}
          />
          <MetricCard
            label="At Risk"
            value={atRisk.length}
            icon={TriangleAlert}
            tone="danger"
            description={`${critical.length} need urgent attention`}
            onClick={() => navigate('/inventory?risk=critical')}
          />
          <MetricCard
            label="Purchase Orders"
            value={ws.orders.length}
            icon={ShoppingCart}
            tone="success"
            description={`${ws.orders.filter((o) => o.status === 'draft').length} awaiting review`}
            onClick={() => navigate('/orders')}
          />
          <MetricCard
            label="Data Warnings"
            value={flagged.length}
            icon={Activity}
            tone="blue"
            description="products to review"
            onClick={() => navigate('/analytics')}
          />
        </div>
        <div className="dashboard-chart-row">
          <Panel
            title="Inventory Overview"
            action={<TextLink onClick={() => navigate('/analytics')}>View details</TextLink>}
          >
            <InventoryDonut products={ws.products} />
          </Panel>
          <Panel
            title="Demand vs Forecast"
            action={
              <select
                className="small-select"
                aria-label="Chart period"
                value={months}
                onChange={(e) => setMonths(Number(e.target.value))}
              >
                <option value={6}>Last 6 months</option>
                <option value={9}>Last 9 months</option>
                <option value={12}>Last 12 months</option>
              </select>
            }
          >
            <div className="chart-product-label">
              {ws.products[0]?.name ?? 'Select a dataset'} <span>· {ws.products[0]?.code || 'No data'}</span>
            </div>
            <DemandChart explanation={explanation} demo={ws.mode === 'demo'} months={months} />
          </Panel>
        </div>
        <div className="dashboard-middle-row">
          <Panel
            title={ws.mode === 'demo' ? 'Products by Warehouse' : 'Products by Supplier'}
            action={
              ws.mode === 'demo' ? (
                <select
                  className="small-select"
                  aria-label="Warehouse chart filter"
                  value={warehouse}
                  onChange={(e) => setWarehouse(e.target.value)}
                >
                  <option value="">All Warehouses</option>
                  {[...new Set(ws.products.map((p) => p.warehouse))].map((w) => (
                    <option key={w}>{w}</option>
                  ))}
                </select>
              ) : (
                <span className="muted text-small">SKU distribution</span>
              )
            }
          >
            <StockBars
              products={warehouse ? ws.products.filter((p) => p.warehouse === warehouse) : ws.products}
              group={ws.mode === 'demo' ? 'warehouse' : 'supplier'}
            />
          </Panel>
          <Panel
            title="Recent Activity"
            action={<TextLink onClick={() => navigate('/reports')}>See all</TextLink>}
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
                      'order.draft': 'New purchase order',
                      'order.approve': 'Purchase order approved',
                      'order.edit': 'Order quantities updated',
                      'order.cancel': 'Order cancelled',
                      'plan.create': 'Forecast updated',
                      'dataset.import': 'Inventory imported',
                    }[event.action] || event.action.replaceAll('.', ' ')}
                  </span>
                  <time>
                    {new Date(event.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </time>
                  <span
                    className={`badge ${event.action === 'order.cancel' ? 'badge-cancelled' : 'badge-covered'}`}
                  >
                    {event.action === 'order.draft'
                      ? 'Created'
                      : event.action === 'order.cancel'
                        ? 'Cancelled'
                        : 'Success'}
                  </span>
                </button>
              ))}
              {!ws.events.length && (
                <p className="muted empty-inline">Your workspace activity will appear here.</p>
              )}
            </div>
          </Panel>
        </div>
        <InventoryTable compact onSelect={showProduct} />
        <div className="dashboard-bottom-note">
          <span className="connection-dot" />
          {ws.mode === 'demo'
            ? 'Exploring demo data. Connect your workspace to see live inventory.'
            : 'Inventory scope: consolidated supplier data. Forecasts use saved scenario assumptions.'}
          <button onClick={() => navigate('/settings')}>
            {ws.mode === 'demo' ? 'Connect workspace' : 'Manage connection'}
            <ArrowRight size={13} />
          </button>
        </div>
      </div>
      <aside className="dashboard-rail">
        <section className="intelligence-banner">
          <span className="banner-label">
            <Sparkles size={13} /> INVENTORY INTELLIGENCE
          </span>
          <h2>
            Smarter inventory
            <br />
            for a bigger tomorrow.
          </h2>
          <button onClick={() => navigate('/agent')}>
            Run AI Analysis <ArrowRight size={16} />
          </button>
        </section>
        <Panel
          title="AI Insights"
          action={
            <TextLink onClick={() => setAllInsights((v) => !v)}>
              {allInsights ? 'Show less' : `See all (${insights.length})`}
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
          title="Top Products by Stock Risk"
          action={<TextLink onClick={() => navigate('/inventory?risk=critical')}>View all</TextLink>}
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
                <span className="stock-left">{formatNumber(p.available)} left</span>
              </button>
            ))}
            {!topProducts.length && (
              <p className="muted empty-inline">Import inventory to see stock risks.</p>
            )}
          </div>
        </Panel>
        <Panel title="Inventory Health">
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
              <span>Current coverage</span>
            </div>
            <div className="health-number">
              <strong>{healthy}%</strong>
              <span>Overall Health</span>
              <small>
                <span className="connection-dot live" />
                {healthy >= 80 ? 'In good shape' : 'Needs attention'}
              </small>
            </div>
          </div>
        </Panel>
        <div className="rail-note">
          <Zap size={14} />
          <span>
            {ws.mode === 'demo'
              ? 'Demo insights · illustrative inventory'
              : 'Insights from your latest planning run'}
          </span>
        </div>
      </aside>
    </div>
  )
}
