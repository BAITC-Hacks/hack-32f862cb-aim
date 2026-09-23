import { formatDateTime, t, useLanguage } from '../i18n'
import { useId } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  BarChart,
  Bar,
  Cell,
} from 'recharts'
import { formatNumber } from '../lib/format'
import type { Explanation, Product } from '../types'

const colors = ['#55cc93', '#6876ee', '#a087d8', '#d79351', '#489eaf']
export function InventoryDonut({ products, compact = false }: { products: Product[]; compact?: boolean }) {
  useLanguage()
  const counts = ['covered', 'reorder', 'critical', 'insufficient_data'].map(
    (r) => products.filter((p) => p.risk === r).length,
  )
  const total = products.length || 1
  const percentage = Math.round((counts[0] / total) * 100)
  let offset = 0
  return (
    <div className={`inventory-overview ${compact ? 'compact' : ''}`}>
      <div className="donut">
        <svg viewBox="0 0 180 180" role="img" aria-label={t`${percentage}% healthy inventory`}>
          <circle cx="90" cy="90" r="72" fill="none" stroke="#292c31" strokeWidth="15" />
          {counts.map((n, i) => {
            const start = offset
            offset += (n / total) * 100
            return (
              <circle
                key={i}
                cx="90"
                cy="90"
                r="72"
                fill="none"
                pathLength="100"
                stroke={['#57ce95', '#e9bd59', '#e57268', '#454951'][i]}
                strokeWidth="15"
                strokeDasharray={`${(n / total) * 100} ${100 - (n / total) * 100}`}
                strokeDashoffset={-start}
                transform="rotate(-90 90 90)"
              />
            )
          })}
        </svg>
        <div className="donut-label">
          <strong>{percentage}%</strong>
          <span>{t('Healthy')}</span>
        </div>
      </div>
      <div className="donut-legend">
        {[t('Healthy'), t('At Risk'), t('Critical'), t('No forecast')].map(
          (label, i) =>
            (counts[i] > 0 || i < 3) && (
              <div key={label}>
                <i style={{ background: ['#57ce95', '#e9bd59', '#e57268', '#454951'][i] }} />
                <span>{label}</span>
                <strong>{formatNumber(counts[i])}</strong>
              </div>
            ),
        )}
      </div>
    </div>
  )
}

export function DemandChart({
  explanation,
  demo = false,
  months = 9,
  large = false,
}: {
  explanation: Explanation | null
  demo?: boolean
  months?: number
  large?: boolean
}) {
  useLanguage()
  const id = useId().replaceAll(':', '')
  let chart: { month: string; actual?: number; raw?: number | null; forecast?: number }[] = []
  const hasRawSales = !demo && !!explanation?.raw_monthly_sales?.length
  if (explanation) {
    const raw = new Map(explanation.raw_monthly_sales?.map((p) => [p.month, p.quantity]))
    chart = explanation.cleaned_monthly_sales.slice(-months).map((p, i) => ({
      month: formatDateTime(new Date(p.month), {
        month: 'short',
        year: large ? '2-digit' : undefined,
      }),
      actual: p.quantity,
      ...(hasRawSales ? { raw: raw.get(p.month) } : {}),
      ...(demo ? { forecast: Math.round(p.quantity * (0.85 + i * 0.035)) } : {}),
    }))
    if (!demo) {
      const forecast = new Map<string, number>()
      explanation.daily_projection.forEach((p) => {
        const key = p.date.slice(0, 7)
        forecast.set(key, (forecast.get(key) ?? 0) + Number(p.demand))
      })
      chart.push(
        ...Array.from(forecast, ([month, quantity]) => ({
          month: formatDateTime(new Date(`${month}-01`), {
            month: 'short',
            year: large ? '2-digit' : undefined,
          }),
          forecast: Math.round(quantity),
        })),
      )
    }
  }
  if (!chart.length || !explanation?.cleaned_monthly_sales.length)
    return <div className="chart-empty">{t('No observed sales history for a demand forecast.')}</div>
  return (
    <div className={`demand-chart ${large ? 'chart-large' : ''}`}>
      <div className="chart-canvas">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart data={chart} margin={{ top: 20, right: 10, left: -25, bottom: 0 }}>
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7682ed" stopOpacity={0.12} />
                <stop offset="100%" stopColor="#7682ed" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#25282d" vertical={false} />
            <XAxis
              dataKey="month"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#9197a2', fontSize: 10 }}
              minTickGap={14}
              dy={8}
            />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#858b95', fontSize: 10 }} tickCount={4} />
            <Tooltip
              contentStyle={{
                background: '#202327',
                border: '1px solid #393d46',
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: '#fff' }}
            />
            <Area
              type="monotone"
              dataKey="actual"
              name={demo ? t('Actual sales') : t('Regular demand')}
              fill={`url(#${id})`}
              stroke="#7d83f5"
              strokeWidth={2}
              dot={{ r: 2, strokeWidth: 0, fill: '#9397ff' }}
              isAnimationActive={false}
            />
            {hasRawSales && (
              <Line
                type="monotone"
                dataKey="raw"
                name={t('Source sales')}
                stroke="#dba76d"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            )}
            <Line
              type="monotone"
              dataKey="forecast"
              name={t('Forecast')}
              stroke="#b6c4ec"
              strokeDasharray="6 6"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-legend">
        <span>
          <i />
          {demo ? t('Actual sales') : t('Regular demand')}
        </span>
        {hasRawSales && (
          <span>
            <i style={{ background: '#dba76d' }} />
            {t('Source sales')}
          </span>
        )}
        <span>
          <i className="dashed" />
          {t('Forecast')}
        </span>
        {demo && <span className="muted">{t('Illustrative data')}</span>}
      </div>
    </div>
  )
}

export function StockBars({
  products,
  group = 'warehouse',
}: {
  products: Product[]
  group?: 'warehouse' | 'supplier'
}) {
  useLanguage()
  const groups = new Map<string, number>()
  products.forEach((p) => {
    const name = (group === 'warehouse' ? p.warehouse : p.supplier) || t('Consolidated')
    groups.set(name, (groups.get(name) ?? 0) + 1)
  })
  const rows = Array.from(groups, ([name, value]) => ({ name, value })).slice(0, 8)
  const maximum = Math.max(...rows.map((r) => r.value), 1)
  return (
    <div className="stock-bars" role="img" aria-label={t`SKU distribution by ${t(group)}`}>
      <div className="bar-grid" />
      {rows.map((r, i) => (
        <div className="stock-bar-column" key={r.name}>
          <div className="stock-bar-space">
            <div
              className="stock-bar"
              style={{ height: `${(r.value / maximum) * 80}%`, background: colors[i % colors.length] }}
            >
              <span>{Math.round((r.value / (products.length || 1)) * 100)}%</span>
            </div>
          </div>
          <span className="stock-bar-label">
            {r.name === 'iek' ? 'IEK' : r.name === 'systeme' ? 'Systeme' : r.name}
          </span>
        </div>
      ))}
    </div>
  )
}

export function CategoryChart({ products }: { products: Product[] }) {
  useLanguage()
  const map = new Map<string, number>()
  products.forEach((p) =>
    map.set(p.category || t('Uncategorised'), (map.get(p.category || t('Uncategorised')) ?? 0) + 1),
  )
  const rows = Array.from(map, ([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
  return (
    <div className="category-chart">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 30, top: 5 }}>
          <CartesianGrid stroke="#25282d" horizontal={false} />
          <XAxis type="number" tick={{ fill: '#858b95', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fill: '#b3b8c2', fontSize: 11 }}
            width={112}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: '#ffffff05' }}
            contentStyle={{ background: '#202327', border: '1px solid #393d46', borderRadius: 8 }}
          />
          <Bar
            dataKey="count"
            name={t('Products')}
            radius={[0, 4, 4, 0]}
            barSize={19}
            isAnimationActive={false}
          >
            {rows.map((r, i) => (
              <Cell key={r.name} fill={colors[i % colors.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
