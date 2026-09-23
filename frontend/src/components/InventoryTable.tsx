import { t, useLanguage } from '../i18n'
import { useMemo, useState } from 'react'
import {
  ArrowDownUp,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  Package,
  X,
} from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useWorkspace } from '../store'
import { csvBlob, downloadBlob, formatNumber, riskLabels, supplierName } from '../lib/format'
import type { Product, Risk } from '../types'
import { Badge, Button, EmptyState, SearchInput } from './ui'

export function InventoryTable({
  compact = false,
  onSelect,
}: {
  compact?: boolean
  onSelect: (product: Product) => void
}) {
  useLanguage()
  const { products, mode, notify } = useWorkspace()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [localRisk, setLocalRisk] = useState('all')
  const risk = compact ? localRisk : params.get('risk') || 'all'
  const [supplier, setSupplier] = useState(compact ? '' : params.get('supplier') || '')
  const [warehouse, setWarehouse] = useState('')
  const [filters, setFilters] = useState(false)
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState<{ key: 'code' | 'available' | 'recommended'; desc: boolean } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const pageSize = compact ? 5 : 12
  const filtered = useMemo(
    () =>
      products
        .filter(
          (p) =>
            (risk === 'all' || p.risk === risk) &&
            (!supplier || p.supplier === supplier) &&
            (!warehouse || p.warehouse === warehouse) &&
            `${p.code} ${p.name} ${supplierName(p.supplier)}`.toLowerCase().includes(query.toLowerCase()),
        )
        .sort((a, b) =>
          !sort
            ? 0
            : (sort.key === 'code'
                ? a.code.localeCompare(b.code)
                : (a[sort.key] ?? -Infinity) - (b[sort.key] ?? -Infinity)) * (sort.desc ? -1 : 1),
        ),
    [products, risk, supplier, warehouse, query, sort],
  )
  const maxPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1)
  const currentPage = Math.min(page, maxPage)
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  const allSelected = visible.length > 0 && visible.every((p) => selected.has(p.id))
  const selectedRows = filtered.filter((p) => selected.has(p.id))
  function changeRisk(value: string) {
    if (compact) setLocalRisk(value)
    else {
      const next = new URLSearchParams(params)
      if (value === 'all') next.delete('risk')
      else next.set('risk', value)
      setParams(next, { replace: true })
    }
    setPage(0)
  }
  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function exportRows() {
    const rows = selectedRows.length ? selectedRows : filtered
    downloadBlob(
      csvBlob([
        [
          'SKU',
          t('Product'),
          t('Supplier'),
          t('Scope'),
          t('Stock'),
          t('Unit'),
          t('Recommended'),
          t('Status'),
        ],
        ...rows.map((p) => [
          p.code,
          p.name,
          supplierName(p.supplier),
          p.warehouse || t('Supplier aggregate'),
          p.available,
          p.unit,
          p.recommended,
          riskLabels[p.risk],
        ]),
      ]),
      'optistock-inventory.csv',
    )
    notify(t`${rows.length} inventory rows exported.`)
  }
  const sortBy = (key: 'code' | 'available' | 'recommended') =>
    setSort((s) => ({ key, desc: s?.key === key ? !s.desc : false }))
  return (
    <section className={`panel inventory-panel ${compact ? 'inventory-compact' : ''}`}>
      <div className="inventory-toolbar">
        <div className="inventory-title-group">
          <h2>{compact ? t('Inventory List') : t('All products')}</h2>
          <div className="status-tabs" aria-label={t('Inventory status')}>
            {['all', 'critical', 'reorder', 'covered', ...(compact ? [] : ['insufficient_data'])].map((r) => (
              <button key={r} className={risk === r ? 'active' : ''} onClick={() => changeRisk(r)}>
                {r === 'all' ? t('All') : riskLabels[r as Risk]}{' '}
                <span>
                  ({formatNumber(r === 'all' ? products.length : products.filter((p) => p.risk === r).length)}
                  )
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="table-actions">
          <SearchInput
            value={query}
            onChange={(v) => {
              setQuery(v)
              setPage(0)
            }}
          />
          <Button
            icon={Filter}
            onClick={() => setFilters((v) => !v)}
            aria-expanded={filters}
            className={supplier || warehouse ? 'is-filtered' : ''}
          >
            {t('Filter')}
          </Button>
          <Button icon={Download} onClick={exportRows} disabled={!filtered.length}>
            {t('Export')}
            {selectedRows.length ? ` (${selectedRows.length})` : ''}
          </Button>
        </div>
      </div>
      {filters && (
        <div className="filter-row">
          <label>
            {t('Supplier')}
            <select
              value={supplier}
              onChange={(e) => {
                setSupplier(e.target.value)
                setPage(0)
              }}
            >
              <option value="">{t('All suppliers')}</option>
              {[...new Set(products.map((p) => p.supplier))].map((s) => (
                <option key={s} value={s}>
                  {supplierName(s)}
                </option>
              ))}
            </select>
          </label>
          {mode === 'demo' && (
            <label>
              {t('Warehouse')}
              <select
                value={warehouse}
                onChange={(e) => {
                  setWarehouse(e.target.value)
                  setPage(0)
                }}
              >
                <option value="">{t('All warehouses')}</option>
                {[...new Set(products.map((p) => p.warehouse))].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          )}
          <Button
            variant="ghost"
            icon={X}
            onClick={() => {
              setSupplier('')
              setWarehouse('')
              setQuery('')
              changeRisk('all')
            }}
          >
            {t('Clear filters')}
          </Button>
        </div>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th className="checkbox-cell">
                <input
                  aria-label={t('Select all visible products')}
                  type="checkbox"
                  checked={allSelected}
                  onChange={() =>
                    setSelected((s) => {
                      const next = new Set(s)
                      visible.forEach((p) => (allSelected ? next.delete(p.id) : next.add(p.id)))
                      return next
                    })
                  }
                />
              </th>
              <th>
                <button onClick={() => sortBy('code')}>
                  SKU <ArrowDownUp size={11} />
                </button>
              </th>
              <th>{t('Product')}</th>
              <th>{mode === 'demo' ? t('Warehouse') : t('Category')}</th>
              <th>{t('Supplier')}</th>
              <th>
                <button onClick={() => sortBy('available')}>
                  {t('Current Stock')} <ArrowDownUp size={11} />
                </button>
              </th>
              {!compact && <th>{t('Unit')}</th>}
              <th>
                <button onClick={() => sortBy('recommended')}>
                  {t('Recommended')} <ArrowDownUp size={11} />
                </button>
              </th>
              <th>{t('Status')}</th>
              <th>{t('Action')}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => (
              <tr key={p.id} className={selected.has(p.id) ? 'selected' : ''}>
                <td className="checkbox-cell">
                  <input
                    type="checkbox"
                    aria-label={t`Select ${p.code}`}
                    checked={selected.has(p.id)}
                    onChange={() => toggle(p.id)}
                  />
                </td>
                <td>
                  <button className="sku-button" onClick={() => onSelect(p)}>
                    {p.code}
                  </button>
                </td>
                <td>
                  <button className="product-name" onClick={() => onSelect(p)}>
                    {!compact && (
                      <span className="table-product-icon">
                        <Package size={16} />
                      </span>
                    )}
                    {p.name}
                  </button>
                </td>
                <td>{mode === 'demo' ? p.warehouse : p.category || '—'}</td>
                <td>{supplierName(p.supplier)}</td>
                <td className="tabular">{formatNumber(p.available)}</td>
                {!compact && <td className="muted">{p.unit}</td>}
                <td className="tabular">{formatNumber(p.recommended)}</td>
                <td>
                  <Badge status={p.risk} />
                </td>
                <td>
                  <button className="text-link" onClick={() => onSelect(p)}>
                    {t('View')} <ArrowRight size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && (
        <EmptyState
          title={t('No products found')}
          description={t('Try a different search or clear your filters.')}
          action={
            <Button
              onClick={() => {
                setQuery('')
                setSupplier('')
                setWarehouse('')
                changeRisk('all')
              }}
            >
              {t('Clear filters')}
            </Button>
          }
        />
      )}
      {!compact && (
        <div className="table-footer">
          <span>
            {t(
              'Showing {0}–{1} of {2} products',
              filtered.length ? currentPage * pageSize + 1 : 0,
              Math.min((currentPage + 1) * pageSize, filtered.length),
              formatNumber(filtered.length),
            )}
            {selectedRows.length ? t` · ${selectedRows.length} selected` : ''}
          </span>
          <div className="pagination">
            <button
              aria-label={t('Previous page')}
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              <ChevronLeft size={15} />
            </button>
            <span>
              {currentPage + 1} / {maxPage + 1}
            </span>
            <button
              aria-label={t('Next page')}
              disabled={currentPage === maxPage}
              onClick={() => setPage(currentPage + 1)}
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
