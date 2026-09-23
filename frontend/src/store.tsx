import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Api } from './lib/api'
import { createDemoSnapshot, defaultScenario, demoExplanation } from './lib/demo'
import { csvBlob, downloadBlob, errorMessage } from './lib/format'
import type { Explanation, Job, Order, OrderLine, Product, Scenario, Snapshot, User } from './types'

const emptySnapshot: Snapshot = {
  products: [],
  datasets: [],
  plans: [],
  orders: [],
  events: [],
  datasetId: '',
  planId: '',
}
function readDemo() {
  const original = createDemoSnapshot()
  try {
    return { ...original, ...JSON.parse(localStorage.getItem('optistock.demo.v1') ?? '{}') } as Snapshot
  } catch {
    return original
  }
}
export interface Notice {
  id: string
  message: string
  kind: 'success' | 'error' | 'info'
}

function useWorkspaceState() {
  const [mode, setMode] = useState<'demo' | 'live'>(() =>
    sessionStorage.getItem('optistock.token') && localStorage.getItem('optistock.mode') === 'live'
      ? 'live'
      : 'demo',
  )
  const [base, setBase] = useState(() => localStorage.getItem('optistock.apiBase') || '/api/v1')
  const [token, setToken] = useState(() => sessionStorage.getItem('optistock.token') || '')
  const [user, setUser] = useState<User>({ id: 'demo-user', name: 'Aigerim K.', role: 'admin' })
  const [data, setData] = useState<Snapshot>(() => (mode === 'demo' ? readDemo() : emptySnapshot))
  const [loading, setLoading] = useState(mode === 'live')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [job, setJob] = useState<Job | null>(null)
  const [notices, setNotices] = useState<Notice[]>([])
  const controller = useRef<AbortController | null>(null)
  const refreshVersion = useRef(0)
  const mutationLock = useRef(false)
  const api = useMemo(() => new Api(base, token), [base, token])

  function notify(message: string, kind: Notice['kind'] = 'success') {
    const id = crypto.randomUUID()
    setNotices((n) => [...n.slice(-3), { id, message, kind }])
    setTimeout(() => setNotices((n) => n.filter((x) => x.id !== id)), kind === 'error' ? 9000 : 4500)
  }

  useEffect(() => {
    if (mode === 'demo') localStorage.setItem('optistock.demo.v1', JSON.stringify(data))
  }, [data, mode])

  useEffect(() => {
    if (mode !== 'live') return
    const abort = new AbortController()
    const version = ++refreshVersion.current
    Promise.all([
      api.request<User>('/me', { signal: abort.signal }),
      api.snapshot(undefined, undefined, abort.signal),
    ])
      .then(([profile, snapshot]) => {
        if (version === refreshVersion.current) {
          setUser(profile)
          setData(snapshot)
          setError('')
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(errorMessage(e))
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false)
      })
    return () => {
      abort.abort()
      controller.current?.abort()
    }
  }, [api, mode])

  async function refresh(datasetId = data.datasetId, planId = data.planId) {
    if (mode === 'demo') return
    const version = ++refreshVersion.current
    setLoading(true)
    try {
      const snapshot = await api.snapshot(datasetId, planId)
      if (version === refreshVersion.current) {
        setData(snapshot)
        setError('')
      }
    } catch (e) {
      if (version === refreshVersion.current) setError(errorMessage(e))
      throw e
    } finally {
      if (version === refreshVersion.current) setLoading(false)
    }
  }

  async function connect(nextBase: string, nextToken: string) {
    if (mutationLock.current) throw new Error('Wait for the current operation to finish.')
    const normalized = nextBase.trim().replace(/\/$/, '')
    if (!normalized || (!normalized.startsWith('/') && !/^https?:\/\//.test(normalized)))
      throw new Error('Use a relative API path or an http(s) URL.')
    const client = new Api(normalized, nextToken.trim())
    const profile = await client.request<User>('/me')
    if (mode === 'live' && normalized === base && nextToken.trim() === token) {
      await refresh()
      setUser(profile)
      notify(`Connected as ${profile.name}`)
      return
    }
    controller.current?.abort()
    refreshVersion.current++
    sessionStorage.setItem('optistock.token', nextToken.trim())
    localStorage.setItem('optistock.apiBase', normalized)
    localStorage.setItem('optistock.mode', 'live')
    setBase(normalized)
    setToken(nextToken.trim())
    setUser(profile)
    setData(emptySnapshot)
    setLoading(true)
    setError('')
    setJob(null)
    setMode('live')
    notify(`Connected as ${profile.name}`)
  }

  function useDemo() {
    if (mutationLock.current) {
      notify('Wait for the current operation to finish.', 'info')
      return
    }
    controller.current?.abort()
    refreshVersion.current++
    sessionStorage.removeItem('optistock.token')
    localStorage.setItem('optistock.mode', 'demo')
    setToken('')
    setData(readDemo())
    setMode('demo')
    setUser({ id: 'demo-user', name: 'Aigerim K.', role: 'admin' })
    setError('')
    setLoading(false)
    setJob(null)
  }

  async function perform<T>(operation: () => Promise<T>) {
    if (mutationLock.current) throw new Error('Another operation is in progress.')
    mutationLock.current = true
    setBusy(true)
    try {
      return await operation()
    } catch (e) {
      notify(errorMessage(e), 'error')
      throw e
    } finally {
      mutationLock.current = false
      setBusy(false)
    }
  }

  function addDemoEvent(snapshot: Snapshot, action: string, entityId: string): Snapshot {
    return {
      ...snapshot,
      events: [
        {
          id: crypto.randomUUID(),
          action,
          entity_id: entityId,
          created_at: new Date().toISOString(),
          details: {},
        },
        ...snapshot.events,
      ],
    }
  }

  async function trackJob(jobId: string) {
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    await api.waitForJob(jobId, setJob, abort.signal)
  }

  async function importData(files?: File[], supplier = 'iek', asOf = '2026-09-22') {
    return perform(async () => {
      if (mode === 'demo') throw new Error('Connect your API in Settings to import Excel files.')
      let body: unknown = { as_of: asOf }
      if (files) {
        const form = new FormData()
        form.set('supplier', supplier)
        form.set('as_of', asOf)
        files.forEach((f) => form.append('files', f))
        body = form
      }
      const result = await api.mutate<{ dataset_id: string; job_id: string }>(
        files ? '/datasets/upload' : '/datasets/sample',
        body,
      )
      await trackJob(result.job_id)
      await refresh(result.dataset_id, '')
      notify('Dataset imported. Your inventory is ready.')
    })
  }

  async function runPlan(scenario: Scenario) {
    return perform(async () => {
      if (!data.datasetId) throw new Error('Import or select a ready dataset first.')
      if (mode === 'demo') {
        const planId = `demo-plan-${Date.now()}`
        setData((d) => {
          const products = d.products.map((p) => {
            if (
              (scenario.supplier && p.supplier !== scenario.supplier) ||
              (scenario.category && p.category !== scenario.category)
            )
              return {
                ...p,
                recommended: null,
                forecast: null,
                risk: 'insufficient_data' as const,
                recommendationId: undefined,
              }
            const baseDemand = createDemoSnapshotProductForecast(p)
            const forecast = Math.round(
              ((baseDemand * (scenario.lead_time_days + scenario.review_days)) / 60) *
                (1 + scenario.growth_percent / 100),
            )
            const quantity = Math.max(
              0,
              Math.ceil(
                (forecast * (1 + scenario.safety_days / (scenario.lead_time_days + scenario.review_days)) -
                  (p.available ?? 0)) /
                  10,
              ) * 10,
            )
            return {
              ...p,
              forecast,
              recommended: quantity,
              risk:
                (p.available ?? 0) <
                (forecast * scenario.lead_time_days) / (scenario.lead_time_days + scenario.review_days)
                  ? ('critical' as const)
                  : quantity
                    ? ('reorder' as const)
                    : ('covered' as const),
              recommendationId: `rec-${p.id}`,
            }
          })
          return addDemoEvent(
            {
              ...d,
              products,
              planId,
              plans: [
                {
                  id: planId,
                  dataset_id: d.datasetId,
                  status: 'ready',
                  created_at: new Date().toISOString(),
                  parameters: scenario,
                  summary: { items: products.length },
                },
                ...d.plans,
              ],
            },
            'plan.create',
            planId,
          )
        })
        notify('Demo scenario updated. Recommendations recalculated.')
        return
      }
      const result = await api.mutate<{ plan_id: string; job_id: string }>('/plans', {
        dataset_id: data.datasetId,
        scenario,
      })
      await trackJob(result.job_id)
      await refresh(data.datasetId, result.plan_id)
      notify('Analysis complete. Recommendations are ready.')
    })
  }

  async function draftOrders() {
    return perform(async () => {
      if (!data.planId) throw new Error('Run a forecast before creating orders.')
      if (mode === 'demo') {
        const existing = data.orders.filter((o) => o.plan_id === data.planId)
        if (existing.length) {
          notify('Drafts for this plan already exist.', 'info')
          return
        }
        const suppliers = [
          ...new Set(data.products.filter((p) => (p.recommended ?? 0) > 0).map((p) => p.supplier)),
        ]
        const orders: Order[] = suppliers.map((supplier, i) => ({
          id: `PO-${Date.now().toString().slice(-6)}-${i + 1}`,
          plan_id: data.planId,
          supplier,
          status: 'draft',
          revision: 1,
          created_at: new Date().toISOString(),
          arrival_date: new Date(Date.now() + (data.plans[0]?.parameters.lead_time_days ?? 30) * 86400000)
            .toISOString()
            .slice(0, 10),
          lines: data.products
            .filter((p) => p.supplier === supplier && (p.recommended ?? 0) > 0)
            .map((p) => ({
              id: crypto.randomUUID(),
              item_id: p.id,
              code: p.code,
              name: p.name,
              unit: p.unit,
              quantity: String(p.recommended),
              recommended_quantity: String(p.recommended),
              reason: null,
            })),
        }))
        setData((d) =>
          addDemoEvent({ ...d, orders: [...orders, ...d.orders] }, 'order.draft', orders[0]?.id ?? d.planId),
        )
        notify(
          orders.length
            ? `${orders.length} supplier orders created.`
            : 'No replenishment needed for this plan.',
          orders.length ? 'success' : 'info',
        )
        return
      }
      const result = await api.mutate<{ order_ids: string[] }>('/orders', { plan_id: data.planId })
      await refresh()
      notify(
        result.order_ids.length
          ? `${result.order_ids.length} supplier orders ready for review.`
          : 'No replenishment needed.',
        result.order_ids.length ? 'success' : 'info',
      )
    })
  }

  async function getOrder(id: string): Promise<Order> {
    if (mode === 'demo') {
      const order = data.orders.find((o) => o.id === id)
      if (!order) throw new Error('Order not found')
      return order
    }
    return api.request<Order>(`/orders/${id}`)
  }

  async function changeOrder(order: Order, action: 'approve' | 'cancel') {
    return perform(async () => {
      if (mode === 'demo') {
        if (action === 'approve' && !order.lines?.some((l) => Number(l.quantity) > 0))
          throw new Error('An empty order cannot be approved.')
        setData((d) =>
          addDemoEvent(
            {
              ...d,
              orders: d.orders.map((o) =>
                o.id === order.id
                  ? {
                      ...o,
                      revision: o.revision + 1,
                      status: action === 'approve' ? 'approved' : 'cancelled',
                    }
                  : o,
              ),
            },
            `order.${action}`,
            order.id,
          ),
        )
      } else {
        await api.mutate(`/orders/${order.id}/${action}`, { revision: order.revision })
        await refresh()
      }
      notify(action === 'approve' ? 'Order approved. Ready to export.' : 'Order cancelled.')
    })
  }

  async function editOrder(order: Order, changes: { line_id: string; quantity: string; reason: string }[]) {
    return perform(async () => {
      if (mode === 'demo') {
        if (
          changes.some(
            (c) => Number(c.quantity) !== 0 && (Number(c.quantity) < 10 || Number(c.quantity) % 10 !== 0),
          )
        )
          throw new Error('Demo orders require a minimum of 10 and multiples of 10, or 0 to remove a line.')
        const byId = new Map(changes.map((c) => [c.line_id, c]))
        setData((d) =>
          addDemoEvent(
            {
              ...d,
              orders: d.orders.map((o) =>
                o.id === order.id
                  ? {
                      ...o,
                      revision: o.revision + 1,
                      lines: o.lines?.map((l) =>
                        byId.has(l.id)
                          ? { ...l, quantity: byId.get(l.id)!.quantity, reason: byId.get(l.id)!.reason }
                          : l,
                      ),
                    }
                  : o,
              ),
            },
            'order.edit',
            order.id,
          ),
        )
      } else {
        await api.mutate(`/orders/${order.id}`, { revision: order.revision, lines: changes }, 'PATCH')
        await refresh()
      }
      notify('Order changes saved.')
    })
  }

  async function exportOrder(order: Order) {
    if (order.status !== 'approved') throw new Error('Approve this order before exporting.')
    const blob =
      mode === 'live'
        ? await api.request<Blob>(`/orders/${order.id}/export`)
        : csvBlob([
            ['Order', 'Revision', 'Supplier', 'SKU', 'Product', 'Unit', 'Quantity', 'Arrival'],
            ...(order.lines ?? [])
              .filter((l) => Number(l.quantity) > 0)
              .map((l) => [
                order.id,
                order.revision,
                order.supplier,
                l.code,
                l.name,
                l.unit,
                l.quantity,
                order.arrival_date,
              ]),
          ])
    downloadBlob(blob, `optistock-${order.id}-r${order.revision}.csv`)
  }

  async function getExplanation(product: Product): Promise<Explanation | null> {
    if (!product.recommendationId) return null
    if (mode === 'demo') return demoExplanation(product)
    return (await api.request<{ explanation: Explanation }>(`/recommendations/${product.recommendationId}`))
      .explanation
  }

  async function retryJob() {
    if (!job || job.status !== 'failed') return
    return perform(async () => {
      await api.mutate(`/jobs/${job.id}/retry`)
      await trackJob(job.id)
      await refresh('', '')
      notify('Processing completed.')
    })
  }

  return {
    ...data,
    mode,
    base,
    user,
    loading,
    error,
    busy,
    job,
    notices,
    api,
    canPlan: mode === 'demo' || ['admin', 'planner'].includes(user.role),
    canApprove: mode === 'demo' || ['admin', 'approver'].includes(user.role),
    scenario: data.plans.find((p) => p.id === data.planId)?.parameters ?? defaultScenario,
    notify,
    dismissNotice: (id: string) => setNotices((n) => n.filter((x) => x.id !== id)),
    connect,
    useDemo,
    refresh,
    importData,
    runPlan,
    draftOrders,
    getOrder,
    changeOrder,
    editOrder,
    exportOrder,
    getExplanation,
    retryJob,
    resetDemo: () => {
      setData(createDemoSnapshot())
      notify('Demo workspace restored.')
    },
  }
}

// The original seed is stable, so repeating a demo scenario never compounds its growth.
const demoForecast = new Map(createDemoSnapshot().products.map((p) => [p.id, p.forecast ?? 0]))
function createDemoSnapshotProductForecast(product: Product) {
  return demoForecast.get(product.id) ?? 0
}

type Workspace = ReturnType<typeof useWorkspaceState>
const WorkspaceContext = createContext<Workspace | null>(null)
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const workspace = useWorkspaceState()
  return <WorkspaceContext.Provider value={workspace}>{children}</WorkspaceContext.Provider>
}
export function useWorkspace() {
  const workspace = useContext(WorkspaceContext)
  if (!workspace) throw new Error('WorkspaceProvider is missing')
  return workspace
}

export type { OrderLine }
