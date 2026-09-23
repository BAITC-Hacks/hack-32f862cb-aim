import { t } from '../i18n'
import type { AuditEvent, Dataset, Job, Order, Plan, Product, Recommendation, Snapshot } from '../types'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export class Api {
  private pendingKeys = new Map<string, string>()
  readonly base: string
  private token: string
  constructor(base: string, token: string) {
    this.base = base
    this.token = token
  }

  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers)
    headers.set('Authorization', `Bearer ${this.token}`)
    if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
    const response = await fetch(`${this.base.replace(/\/$/, '')}${path}`, {
      ...options,
      headers,
      signal: options.signal ?? AbortSignal.timeout(60000),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      const details = error.details
        ?.map((d: { field: string; message: string }) => `${d.field}: ${d.message}`)
        .join('; ')
      throw new ApiError(
        [error.message ? t(error.message) : t`Request failed (${response.status})`, details]
          .filter(Boolean)
          .join(' — '),
        response.status,
      )
    }
    return response.headers.get('content-type')?.includes('application/json')
      ? response.json()
      : (response.blob() as Promise<T>)
  }

  async mutate<T>(path: string, body: unknown = {}, method = 'POST'): Promise<T> {
    const payload = body instanceof FormData ? body : JSON.stringify(body)
    // Keep the same key after a timeout/5xx: the server may already have committed the action.
    const identity =
      body instanceof FormData
        ? Array.from(body.entries())
            .map(([k, v]) => `${k}:${v instanceof File ? `${v.name}:${v.size}:${v.lastModified}` : v}`)
            .join('|')
        : payload
    const signature = `${method}:${path}:${identity}`
    const key = this.pendingKeys.get(signature) ?? crypto.randomUUID()
    this.pendingKeys.set(signature, key)
    try {
      const result = await this.request<T>(path, {
        method,
        body: payload as BodyInit,
        headers: { 'Idempotency-Key': key },
      })
      this.pendingKeys.delete(signature)
      return result
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) this.pendingKeys.delete(signature)
      throw error
    }
  }

  async all<T>(path: string, signal?: AbortSignal): Promise<T[]> {
    const separator = path.includes('?') ? '&' : '?'
    const first = await this.request<{ items: T[]; total?: number }>(
      `${path}${separator}limit=200&offset=0`,
      { signal },
    )
    const items = [...first.items]
    if (first.total != null) {
      for (let offset = 200; offset < first.total; offset += 800) {
        const offsets = [offset, offset + 200, offset + 400, offset + 600].filter((n) => n < first.total!)
        const pages = await Promise.all(
          offsets.map((n) =>
            this.request<{ items: T[] }>(`${path}${separator}limit=200&offset=${n}`, { signal }),
          ),
        )
        pages.forEach((page) => items.push(...page.items))
      }
    } else {
      for (let offset = 200; items.length === offset; offset += 200) {
        const page = await this.request<{ items: T[] }>(`${path}${separator}limit=200&offset=${offset}`, {
          signal,
        })
        items.push(...page.items)
        if (page.items.length < 200) break
      }
    }
    return items
  }

  async snapshot(selectedDataset?: string, selectedPlan?: string, signal?: AbortSignal): Promise<Snapshot> {
    const [datasets, plans, orders, events] = await Promise.all([
      this.all<Dataset>('/datasets', signal),
      this.all<Plan>('/plans', signal),
      this.all<Order>('/orders', signal),
      this.request<{ items: AuditEvent[] }>('/audit?limit=50', { signal }).then((r) => r.items),
    ])
    const dataset =
      datasets.find((d) => d.id === selectedDataset && d.status === 'ready') ??
      datasets.find((d) => d.status === 'ready')
    const plan =
      plans.find((p) => p.id === selectedPlan && p.dataset_id === dataset?.id && p.status === 'ready') ??
      plans.find((p) => p.dataset_id === dataset?.id && p.status === 'ready')
    const [items, recommendations] = await Promise.all([
      dataset ? this.all<Product>(`/items?dataset_id=${dataset.id}`, signal) : [],
      plan ? this.all<Recommendation>(`/plans/${plan.id}/recommendations`, signal) : [],
    ])
    const byItem = new Map(recommendations.map((r) => [r.item_id, r]))
    const products = items.map((i) => {
      const rec = byItem.get(i.id)
      return {
        ...i,
        available: i.available == null ? null : Number(i.available),
        minimum: i.minimum == null ? null : Number(i.minimum),
        multiple: i.multiple == null ? null : Number(i.multiple),
        risk: rec?.risk ?? 'insufficient_data',
        recommended: rec ? Number(rec.quantity) : null,
        forecast: null,
        recommendationId: rec?.id,
        warnings: rec?.warnings ?? [],
        reason: rec?.reason,
      } satisfies Product
    })
    return { products, datasets, plans, orders, events, datasetId: dataset?.id ?? '', planId: plan?.id ?? '' }
  }

  async waitForJob(id: string, update: (job: Job) => void, signal: AbortSignal) {
    const deadline = Date.now() + 20 * 60 * 1000
    while (Date.now() < deadline) {
      signal.throwIfAborted()
      const job = await this.request<Job>(`/jobs/${id}`, { signal })
      update(job)
      if (job.status === 'succeeded') return job
      if (job.status === 'failed')
        throw new Error(job.error?.message ?? t('Processing failed. Retry the job below.'))
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer)
          reject(signal.reason)
        }
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', abort)
          resolve()
        }, 1500)
        signal.addEventListener('abort', abort, { once: true })
      })
    }
    throw new Error(
      t(
        'Processing is taking longer than expected. The job continues on the server; refresh to check its result.',
      ),
    )
  }
}
