import { getNumberLocale, formatDateTime, t, useLanguage } from '../i18n'
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
  useLanguage()
  const ws = useWorkspace()
  const [query, setQuery] = useState('')
  const [eventType, setEventType] = useState('all')
  const events = ws.events.filter(
    (e) =>
      (eventType === 'all' || e.action.startsWith(eventType)) &&
      `${t(e.action)} ${e.action} ${e.entity_id}`.toLowerCase().includes(query.toLowerCase()),
  )
  const reports = [
    {
      title: t('Inventory snapshot'),
      description: t('A complete catalog with stock levels, supplier details and current risk.'),
      icon: FileSpreadsheet,
      name: 'inventory',
      rows: [
        ['SKU', t('Product'), t('Supplier'), t('Stock'), t('Unit'), t('Status')],
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
      title: t('Purchase recommendations'),
      description: t('Recommended quantities and assumptions from your active planning run.'),
      icon: ClipboardList,
      name: 'recommendations',
      rows: [
        ['SKU', t('Product'), t('Supplier'), t('Recommended quantity'), t('Unit'), t('Risk'), t('Warnings')],
        ...ws.products
          .filter((p) => p.recommendationId)
          .map((p) => [
            p.code,
            p.name,
            supplierName(p.supplier),
            p.recommended,
            p.unit,
            riskLabels[p.risk],
            p.warnings.map((warning) => t(warning)).join(', '),
          ]),
      ],
    },
    {
      title: t('Activity & decision log'),
      description: t('A traceable history of imports, calculations and purchase decisions.'),
      icon: History,
      name: 'activity',
      rows: [
        [t('Date'), t('Action'), t('Entity'), t('Details')],
        ...ws.events.map((e) => [e.created_at, e.action, e.entity_id, JSON.stringify(e.details)]),
      ],
    },
  ]
  return (
    <div className="page">
      <PageHeader
        eyebrow={t('Workspace / Reports')}
        title={t('Good decisions leave a trail.')}
        description={t('Export the data you need and follow every change across your workspace.')}
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
              <span>
                {(r.rows.length - 1).toLocaleString(getNumberLocale())} {t('records')}
              </span>
              <Button
                icon={ArrowDownToLine}
                disabled={r.rows.length < 2}
                onClick={() => {
                  downloadBlob(csvBlob(r.rows), `optistock-${r.name}.csv`)
                  ws.notify(t`${r.title} exported.`)
                }}
              >
                {t('Download')}
              </Button>
            </div>
          </section>
        ))}
      </div>
      <Panel title={t('Dataset history')} action={<CalendarDays size={17} />}>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t('Dataset')}</th>
                <th>{t('Snapshot date')}</th>
                <th>{t('Imported')}</th>
                <th>{t('Products')}</th>
                <th>{t('Files')}</th>
                <th>{t('Status')}</th>
                <th>{t('Action')}</th>
              </tr>
            </thead>
            <tbody>
              {ws.datasets.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.id === 'demo-dataset' ? t('Demo inventory') : d.id.slice(0, 8)}
                    {d.id === ws.datasetId && <span className="active-dataset">{t('Active')}</span>}
                  </td>
                  <td>{formatDate(d.as_of)}</td>
                  <td>{formatDate(d.created_at)}</td>
                  <td>{d.summary.items?.toLocaleString(getNumberLocale()) ?? '—'}</td>
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
                      {t('Use dataset')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!ws.datasets.length && (
          <EmptyState
            title={t('No imported datasets')}
            description={t('Import your workbooks to create the first inventory snapshot.')}
          />
        )}
      </Panel>
      <Panel
        title={t('Recent activity')}
        action={
          <span className="muted text-small">
            {t('Latest')} {ws.events.length} {t('events')}
          </span>
        }
      >
        <div className="report-filters">
          <SearchInput
            value={query}
            onChange={setQuery}
            label={t('Search activity')}
            placeholder={t('Search action or entity...')}
          />
          <select
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            aria-label={t('Activity type')}
          >
            <option value="all">{t('All activity')}</option>
            <option value="order">{t('Purchase orders')}</option>
            <option value="plan">{t('Forecasts')}</option>
            <option value="dataset">{t('Imports')}</option>
            <option value="job">{t('Processing jobs')}</option>
          </select>
        </div>
        <div className="audit-list">
          {events.map((e) => (
            <div key={e.id}>
              <span className="icon-tile neutral">
                <Activity size={16} />
              </span>
              <div>
                <strong>{t(e.action)}</strong>
                <small>{e.entity_id}</small>
              </div>
              <time>
                {formatDateTime(new Date(e.created_at), {
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
            <span>{t('No activity matches this filter.')}</span>
          </div>
        )}
      </Panel>
    </div>
  )
}
