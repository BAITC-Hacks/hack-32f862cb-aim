import { useEffect, useMemo, useState } from 'react'
import { Check, CheckCheck, Download, FilePenLine, Plus, ShoppingCart, X } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useWorkspace } from '../store'
import type { Order } from '../types'
import { errorMessage, formatDate, formatNumber, shortId, supplierName } from '../lib/format'
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  InlineError,
  Loading,
  PageHeader,
  SearchInput,
} from '../components/ui'

function OrderDetails({ id, onClose }: { id: string; onClose: () => void }) {
  const ws = useWorkspace()
  const [order, setOrder] = useState<Order | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [cancelConfirm, setCancelConfirm] = useState(false)
  const dirty =
    order?.lines?.filter((l) => edits[l.id] != null && Number(edits[l.id]) !== Number(l.quantity)) ?? []
  useEffect(() => {
    let active = true
    ws.getOrder(id)
      .then((o) => {
        if (active) {
          setOrder(o)
          setError('')
        }
      })
      .catch((e) => {
        if (active) setError(errorMessage(e))
      })
    return () => {
      active = false
    }
    // Reload after an order mutation so the displayed revision always matches the server.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, ws.orders, ws.api, attempt])
  async function save() {
    if (!order) return
    try {
      await ws.editOrder(
        order,
        dirty.map((l) => ({ line_id: l.id, quantity: edits[l.id], reason: reason.trim() })),
      )
      setEdits({})
      setReason('')
    } catch {
      /* Workspace toast includes server validation and revision conflicts. */
    }
  }
  async function act(action: 'approve' | 'cancel') {
    if (!order) return
    try {
      await ws.changeOrder(order, action)
      setCancelConfirm(false)
    } catch {
      /* Retain the current order for review. */
    }
  }
  return (
    <Dialog
      title={shortId(id)}
      description="Review quantities and approve your next delivery."
      onClose={() => {
        if (!ws.busy) onClose()
      }}
      wide
    >
      {error && <InlineError message={error} retry={() => setAttempt((a) => a + 1)} />}
      {!order ? (
        <Loading text="Loading purchase order..." />
      ) : (
        <>
          <div className="order-details-summary">
            <div>
              <span>Supplier</span>
              <strong>{supplierName(order.supplier)}</strong>
            </div>
            <div>
              <span>Expected arrival</span>
              <strong>{formatDate(order.arrival_date)}</strong>
            </div>
            <div>
              <span>Revision</span>
              <strong>v{order.revision}</strong>
            </div>
            <Badge status={order.status} />
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <div className="table-scroll order-lines-scroll">
              <table>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Product</th>
                    <th>Recommended</th>
                    <th>Order quantity</th>
                    <th>Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lines?.map((line) => (
                    <tr key={line.id}>
                      <td>{line.code}</td>
                      <td>{line.name}</td>
                      <td>{formatNumber(line.recommended_quantity)}</td>
                      <td>
                        {order.status === 'draft' && ws.canPlan ? (
                          <input
                            className="quantity-input"
                            type="number"
                            min="0"
                            max="1000000000"
                            step="0.0001"
                            required
                            aria-label={`Quantity for ${line.code}`}
                            disabled={ws.busy}
                            value={edits[line.id] ?? line.quantity}
                            onChange={(e) => setEdits((v) => ({ ...v, [line.id]: e.target.value }))}
                          />
                        ) : (
                          formatNumber(line.quantity)
                        )}
                      </td>
                      <td>{line.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {dirty.length > 0 && (
              <div className="order-edit-reason">
                <label>
                  Reason for changing quantities
                  <textarea
                    required
                    minLength={3}
                    maxLength={1000}
                    placeholder="e.g. Adjusted for a confirmed customer project"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <p>
                  Quantities must respect each product’s minimum and order multiple. Use 0 to remove a line.
                </p>
                <Button
                  type="submit"
                  icon={Check}
                  variant="primary"
                  loading={ws.busy}
                  disabled={reason.trim().length < 3}
                >
                  Save {dirty.length} changes
                </Button>
              </div>
            )}
          </form>
          {cancelConfirm && (
            <div className="cancel-confirm">
              <strong>Cancel this purchase order?</strong>
              <p>Its quantities will no longer count as a supply commitment in future calculations.</p>
              <div>
                <Button variant="danger" onClick={() => void act('cancel')} loading={ws.busy}>
                  Confirm cancellation
                </Button>
                <Button onClick={() => setCancelConfirm(false)} disabled={ws.busy}>
                  Keep order
                </Button>
              </div>
            </div>
          )}
          <div className="dialog-actions order-dialog-actions">
            <span>
              {order.lines?.length ?? 0} order lines ·{' '}
              {order.status === 'approved' ? 'Ready for export' : 'Review before approval'}
            </span>
            {order.status !== 'cancelled' && ws.canApprove && (
              <Button
                icon={X}
                variant="danger"
                disabled={ws.busy || dirty.length > 0}
                onClick={() => setCancelConfirm(true)}
              >
                Cancel order
              </Button>
            )}
            {order.status === 'draft' && (
              <Button
                icon={CheckCheck}
                variant="primary"
                disabled={!ws.canApprove || dirty.length > 0}
                loading={ws.busy}
                onClick={() => void act('approve')}
              >
                Approve order
              </Button>
            )}
            {order.status === 'approved' && (
              <Button
                icon={Download}
                variant="primary"
                onClick={() => {
                  void ws.exportOrder(order).catch((e) => ws.notify(errorMessage(e), 'error'))
                }}
              >
                Export CSV
              </Button>
            )}
          </div>
          {order.status === 'draft' && !ws.canApprove && (
            <p className="small-note">An approver or administrator must approve this order.</p>
          )}
        </>
      )}
    </Dialog>
  )
}

export function Orders() {
  const ws = useWorkspace()
  const [params] = useSearchParams()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [supplier, setSupplier] = useState(params.get('supplier') || '')
  const [selected, setSelected] = useState<string | null>(params.get('order'))
  const [page, setPage] = useState(0)
  const filtered = useMemo(
    () =>
      ws.orders.filter(
        (o) =>
          (status === 'all' || o.status === status) &&
          (!supplier || o.supplier === supplier) &&
          `${shortId(o.id)} ${supplierName(o.supplier)}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [ws.orders, status, supplier, query],
  )
  const maxPage = Math.max(0, Math.ceil(filtered.length / 12) - 1)
  const currentPage = Math.min(page, maxPage)
  const draft = async () => {
    try {
      await ws.draftOrders()
      setStatus('all')
      setPage(0)
    } catch {
      /* Workspace displays the error. */
    }
  }
  return (
    <div className="page">
      <PageHeader
        eyebrow="Workspace / Orders"
        title="From insight to incoming."
        description="Review recommendations, build supplier orders and keep every decision traceable."
        action={
          <Button
            variant="primary"
            icon={Plus}
            onClick={() => void draft()}
            loading={ws.busy}
            disabled={!ws.canPlan || !ws.planId}
          >
            Create from forecast
          </Button>
        }
      />
      <div className="summary-strip">
        {[
          { label: 'All purchase orders', count: ws.orders.length, icon: ShoppingCart, tone: '' },
          {
            label: 'Awaiting review',
            count: ws.orders.filter((o) => o.status === 'draft').length,
            icon: FilePenLine,
            tone: 'warning',
          },
          {
            label: 'Approved orders',
            count: ws.orders.filter((o) => o.status === 'approved').length,
            icon: CheckCheck,
            tone: 'success',
          },
        ].map(({ label, count, icon: Icon, tone }) => (
          <div className="panel summary-card" key={label}>
            <span className={`icon-tile ${tone}`}>
              <Icon size={21} />
            </span>
            <div>
              <span>{label}</span>
              <strong>{formatNumber(count)}</strong>
            </div>
          </div>
        ))}
      </div>
      <section className="panel">
        <div className="inventory-toolbar">
          <div className="status-tabs">
            {['all', 'draft', 'approved', 'cancelled'].map((s) => (
              <button
                className={status === s ? 'active' : ''}
                key={s}
                onClick={() => {
                  setStatus(s)
                  setPage(0)
                }}
              >
                {s === 'all' ? 'All orders' : s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <div className="table-actions">
            <SearchInput
              label="Search orders"
              placeholder="Search orders..."
              value={query}
              onChange={(v) => {
                setQuery(v)
                setPage(0)
              }}
            />
            <select
              aria-label="Filter orders by supplier"
              value={supplier}
              onChange={(e) => {
                setSupplier(e.target.value)
                setPage(0)
              }}
            >
              <option value="">All suppliers</option>
              {[...new Set(ws.orders.map((o) => o.supplier))].map((s) => (
                <option key={s} value={s}>
                  {supplierName(s)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Supplier</th>
                <th>Created</th>
                <th>Expected arrival</th>
                <th>Revision</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(currentPage * 12, (currentPage + 1) * 12).map((o) => (
                <tr key={o.id}>
                  <td>
                    <button className="sku-button" onClick={() => setSelected(o.id)}>
                      {shortId(o.id)}
                    </button>
                  </td>
                  <td>{supplierName(o.supplier)}</td>
                  <td>{formatDate(o.created_at)}</td>
                  <td>{formatDate(o.arrival_date)}</td>
                  <td>v{o.revision}</td>
                  <td>
                    <Badge status={o.status} />
                  </td>
                  <td>
                    <button className="text-link" onClick={() => setSelected(o.id)}>
                      Review order →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filtered.length && (
          <EmptyState
            title="No orders here yet"
            description={
              ws.planId
                ? 'Create supplier drafts from your latest forecast, then review and approve them.'
                : 'Run a forecast first to generate purchase recommendations.'
            }
            action={
              ws.planId && (
                <Button icon={Plus} onClick={() => void draft()} disabled={!ws.canPlan} loading={ws.busy}>
                  Create from forecast
                </Button>
              )
            }
          />
        )}
        <div className="table-footer">
          <span>{filtered.length} orders</span>
          <div className="pagination">
            <Button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
              Previous
            </Button>
            <span>
              {currentPage + 1} / {maxPage + 1}
            </span>
            <Button disabled={currentPage === maxPage} onClick={() => setPage(currentPage + 1)}>
              Next
            </Button>
          </div>
        </div>
      </section>
      {selected && <OrderDetails id={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
