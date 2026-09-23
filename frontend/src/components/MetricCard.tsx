import { ArrowUp } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { formatNumber } from '../lib/format'

export function MetricCard({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
  description,
  trend,
  onClick,
}: {
  label: string
  value: string | number
  icon: LucideIcon
  tone?: string
  description: string
  trend?: string
  onClick?: () => void
}) {
  return (
    <button className={`metric-card ${tone}`} onClick={onClick} disabled={!onClick}>
      <span className={`icon-tile ${tone}`}>
        <Icon size={22} strokeWidth={1.5} />
      </span>
      <div className="metric-content">
        <span className="metric-label">{label}</span>
        <strong>{typeof value === 'number' ? formatNumber(value) : value}</strong>
        <div className="metric-description">
          {trend && (
            <span>
              <ArrowUp size={12} />
              {trend}
            </span>
          )}
          {description}
        </div>
      </div>
      <div className="mini-bars" aria-hidden="true">
        {[5, 9, 14, 19].map((n) => (
          <i key={n} style={{ height: n }} />
        ))}
      </div>
    </button>
  )
}
