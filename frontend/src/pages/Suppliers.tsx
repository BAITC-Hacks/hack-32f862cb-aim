import { t, useLanguage } from '../i18n'
import { useState } from 'react'
import { ArrowRight, Box, Building2, ShoppingCart, TriangleAlert } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useWorkspace } from '../store'
import { formatNumber, supplierName } from '../lib/format'
import { EmptyState, PageHeader, SearchInput } from '../components/ui'

export function Suppliers() {
  useLanguage()
  const ws = useWorkspace()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const suppliers = [...new Set(ws.products.map((p) => p.supplier))].filter((s) =>
    supplierName(s).toLowerCase().includes(query.toLowerCase()),
  )
  return (
    <div className="page">
      <PageHeader
        eyebrow={t('Workspace / Suppliers')}
        title={t('Stronger supply connections.')}
        description={t('Understand supplier coverage, stock exposure and purchase commitments.')}
        action={
          <SearchInput
            label={t('Search suppliers')}
            placeholder={t('Search suppliers...')}
            value={query}
            onChange={setQuery}
          />
        }
      />
      <div className="supplier-grid">
        {suppliers.map((supplier) => {
          const products = ws.products.filter((p) => p.supplier === supplier)
          const critical = products.filter((p) => p.risk === 'critical').length
          const covered = products.filter((p) => p.risk === 'covered').length
          const orders = ws.orders.filter((o) => o.supplier === supplier)
          const percent = Math.round((covered / products.length) * 100)
          return (
            <section className="panel supplier-card" key={supplier}>
              <div className="supplier-heading">
                <span className="supplier-logo">{supplierName(supplier).slice(0, 2).toUpperCase()}</span>
                <div>
                  <h2>{supplierName(supplier)}</h2>
                  <p>
                    <Building2 size={12} />
                    {t('Electrical supplies')}
                  </p>
                </div>
                <span className="badge badge-covered">{t('In catalog')}</span>
              </div>
              <div className="supplier-stats">
                <div>
                  <Box size={16} />
                  <strong>{formatNumber(products.length)}</strong>
                  <span>{t('Products')}</span>
                </div>
                <div>
                  <TriangleAlert size={16} />
                  <strong>{critical}</strong>
                  <span>{t('Critical SKU')}</span>
                </div>
                <div>
                  <ShoppingCart size={16} />
                  <strong>{orders.length}</strong>
                  <span>{t('Orders')}</span>
                </div>
              </div>
              <div className="supplier-health">
                <span>
                  {t('Inventory health')} <strong>{percent}%</strong>
                </span>
                <div>
                  <i style={{ width: `${percent}%` }} />
                </div>
              </div>
              <div className="supplier-card-footer">
                <button onClick={() => navigate(`/inventory?supplier=${encodeURIComponent(supplier)}`)}>
                  {t('View inventory')}
                  <ArrowRight size={14} />
                </button>
                <button onClick={() => navigate(`/orders?supplier=${encodeURIComponent(supplier)}`)}>
                  {t('View orders')}
                  <ArrowRight size={14} />
                </button>
              </div>
            </section>
          )
        })}
      </div>
      {!suppliers.length && (
        <EmptyState
          title={t('No suppliers found')}
          description={t('Import an inventory dataset or try a different search.')}
        />
      )}
    </div>
  )
}
