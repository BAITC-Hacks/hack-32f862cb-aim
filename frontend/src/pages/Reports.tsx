import { useState } from 'react'
import {
  Activity,
  ArrowDownToLine,
  CalendarDays,
  ClipboardList,
  FileSpreadsheet,
  History,
  Search,
} from 'lucide-react'
import { useWorkspace } from '../store'
import { csvBlob, downloadBlob, formatDate, riskLabels, supplierName } from '../lib/format'
import { Badge, Button, EmptyState, PageHeader, Panel, SearchInput } from '../components/ui'

export function Reports() {
  const ws = useWorkspace()
  const [query, setQuery] = useState('')
  const [eventType, setEventType] = useState('all')
  const events = ws.events.filter(
    (e) =>
      (eventType === 'all' || e.action.startsWith(eventType)) &&
      `${e.action} ${e.entity_id}`.toLowerCase().includes(query.toLowerCase()),
  )
  const reports = [
    {
      title: 'Inventory snapshot',
      description: 'A complete catalog with stock levels, supplier details and current risk.',
      icon: FileSpreadsheet,
      name: 'inventory',
      rows: [
        ['SKU', 'Product', 'Supplier', 'Stock', 'Unit', 'Status'],
        ...ws.products.map((p) => [
          p.code,
          p.name,
          supplierName(p.supplier),
          p.available,
          p.unit,
          riskLabels[p.risk],
        ]),
      ],
    },
    {
      title: 'Purchase recommendations',
      description: 'Recommended quantities and assumptions from your active planning run.',
      icon: ClipboardList,
      name: 'recommendations',
      rows: [
        ['SKU', 'Product', 'Supplier', 'Recommended quantity', 'Unit', 'Risk', 'Warnings'],
        ...ws.products
          .filter((p) => p.recommendationId)
          .map((p) => [
            p.code,
            p.name,
            supplierName(p.supplier),
            p.recommended,
            p.unit,
            riskLabels[p.risk],
            p.warnings.join(', '),
          ]),
      ],
    },
    {
      title: 'Activity & decision log',
      description: 'A traceable history of imports, calculations and purchase decisions.',
      icon: History,
      name: 'activity',
      rows: [
        ['Date', 'Action', 'Entity', 'Details'],
        ...ws.events.map((e) => [e.created_at, e.action, e.entity_id, JSON.stringify(e.details)]),
      ],
    },
  ]
  return (
    <div className="page">
      <PageHeader
        eyebrow="Workspace / Reports"
        title="Good decisions leave a trail."
        description="Export the data you need and follow every change across your workspace."
      />
      <div className="report-grid">
        {reports.map((r) => (
          <section className="panel report-card" key={r.name}>
            <span className="icon-tile blue">
              <r.icon size={23} />
            </span>
            <span className="report-format">CSV</span>
            <h2>{r.title}</h2>
            <p>{r.description}</p>
            <div>
              <span>{(r.rows.length - 1).toLocaleString()} records</span>
              <Button
                icon={ArrowDownToLine}
                disabled={r.rows.length < 2}
                onClick={() => {
                  downloadBlob(csvBlob(r.rows), `optistock-${r.name}.csv`)
                  ws.notify(`${r.title} exported.`)
                }}
              >
                Download
              </Button>
            </div>
          </section>
        ))}
      </div>
      <Panel title="Dataset history" action={<CalendarDays size={17} />}>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Dataset</th>
                <th>Snapshot date</th>
                <th>Imported</th>
                <th>Products</th>
                <th>Files</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {ws.datasets.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.id === 'demo-dataset' ? 'Demo inventory' : d.id.slice(0, 8)}
                    {d.id === ws.datasetId && <span className="active-dataset">Active</span>}
                  </td>
                  <td>{formatDate(d.as_of)}</td>
                  <td>{formatDate(d.created_at)}</td>
                  <td>{d.summary.items?.toLocaleString() ?? '—'}</td>
                  <td>{d.summary.files ?? '—'}</td>
                  <td>
                    <Badge status={d.status} />
                  </td>
                  <td>
                    <Button
                      variant="ghost"
                      disabled={
                        d.status !== 'ready' ||
                        ws.mode === 'demo' ||
                        d.id === ws.datasetId ||
                        ws.busy ||
                        ws.loading
                      }
                      onClick={() => {
                        void ws.refresh(d.id, '').catch(() => {})
                      }}
                    >
                      Use dataset
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!ws.datasets.length && (
          <EmptyState
            title="No imported datasets"
            description="Import your workbooks to create the first inventory snapshot."
          />
        )}
      </Panel>
      <Panel
        title="Recent activity"
        action={<span className="muted text-small">Latest {ws.events.length} events</span>}
      >
        <div className="report-filters">
          <SearchInput
            value={query}
            onChange={setQuery}
            label="Search activity"
            placeholder="Search action or entity..."
          />
          <select value={eventType} onChange={(e) => setEventType(e.target.value)} aria-label="Activity type">
            <option value="all">All activity</option>
            <option value="order">Purchase orders</option>
            <option value="plan">Forecasts</option>
            <option value="dataset">Imports</option>
            <option value="job">Processing jobs</option>
          </select>
        </div>
        <div className="audit-list">
          {events.map((e) => (
            <div key={e.id}>
              <span className="icon-tile neutral">
                <Activity size={16} />
              </span>
              <div>
                <strong>{e.action.replaceAll('.', ' · ')}</strong>
                <small>{e.entity_id}</small>
              </div>
              <time>
                {new Date(e.created_at).toLocaleString('en-GB', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
            </div>
          ))}
        </div>
        {!events.length && (
          <div className="empty-inline">
            <Search size={20} />
            <span>No activity matches this filter.</span>
          </div>
        )}
      </Panel>
    </div>
  )
}
