import { getNumberLocale, t, useLanguage } from '../i18n'
import { useState } from 'react'
import {
  Check,
  CircleHelp,
  Database,
  KeyRound,
  Link2,
  RotateCcw,
  ShieldCheck,
  UploadCloud,
  UserRound,
} from 'lucide-react'
import { useWorkspace } from '../store'
import { useShell } from '../components/Layout'
import { errorMessage, formatDate } from '../lib/format'
import { Badge, Button, InlineError, PageHeader, Panel } from '../components/ui'

import { LanguageSelector } from '../components/LanguageSelector'

export function Settings() {
  useLanguage()
  const ws = useWorkspace()
  const { openImport } = useShell()
  const [base, setBase] = useState(ws.base)
  const [token, setToken] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')
  const [resetConfirm, setResetConfirm] = useState(false)
  async function connect() {
    setConnecting(true)
    setError('')
    try {
      await ws.connect(base, token)
      setToken('')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setConnecting(false)
    }
  }
  return (
    <div className="page settings-page">
      <PageHeader
        eyebrow={t('Workspace / Settings')}
        title={t('A workspace that works for you.')}
        description={t('Manage your connection, access and inventory data.')}
      />
      <div className="settings-layout">
        <div className="settings-main">
          <Panel title={t('Language')}>
            <p className="panel-description">
              {t('Choose your interface language. Your selection is saved in this browser.')}
            </p>
            <LanguageSelector />
          </Panel>
          <Panel
            title={t('Workspace connection')}
            action={
              <span className={`mode-chip ${ws.mode}`}>
                <span className="connection-dot" />
                {ws.mode === 'demo' ? t('Demo workspace') : t('Connected')}
              </span>
            }
          >
            <p className="panel-description">
              {t(
                'Connect to your OptiStock server to import data, run forecasts and manage purchase orders.',
              )}
            </p>
            <form
              className="connection-form"
              onSubmit={(e) => {
                e.preventDefault()
                void connect()
              }}
            >
              <label>
                {t('API address')}
                <div className="input-icon">
                  <Link2 size={16} />
                  <input
                    required
                    value={base}
                    onChange={(e) => setBase(e.target.value)}
                    placeholder="/api/v1"
                    autoComplete="url"
                  />
                </div>
                <small>
                  {t('Use /api/v1 for the local proxy, or your server address ending in /api/v1.')}
                </small>
              </label>
              <label>
                {t('API access key')}
                <div className="input-icon">
                  <KeyRound size={16} />
                  <input
                    type="password"
                    required
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder={t('Enter your personal access key')}
                    autoComplete="off"
                    maxLength={512}
                  />
                </div>
                <small>{t('Your key is stored for this browser session only.')}</small>
              </label>
              {error && <InlineError message={error} />}
              <div className="connection-actions">
                <Button variant="primary" icon={Link2} type="submit" loading={connecting} disabled={ws.busy}>
                  {ws.mode === 'live' ? t('Update connection') : t('Connect workspace')}
                </Button>
                {ws.mode === 'live' && (
                  <Button type="button" onClick={ws.useDemo} disabled={ws.busy}>
                    {t('Disconnect & explore demo')}
                  </Button>
                )}
              </div>
            </form>
          </Panel>
          <Panel title={t('Inventory data')} action={<Database size={18} />}>
            <p className="panel-description">
              {t('Select the inventory snapshot used throughout your workspace.')}
            </p>
            <div className="dataset-setting">
              <label>
                {t('Active dataset')}
                <select
                  aria-label={t('Active dataset')}
                  value={ws.datasetId}
                  disabled={ws.mode === 'demo' || ws.loading || ws.busy}
                  onChange={(e) => {
                    void ws.refresh(e.target.value, '').catch(() => {})
                  }}
                >
                  {!ws.datasetId && <option value="">{t('No ready datasets')}</option>}
                  {ws.datasets
                    .filter((d) => d.status === 'ready')
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {formatDate(d.as_of)} · {d.summary.items?.toLocaleString(getNumberLocale()) ?? '—'}{' '}
                        {t('products ·')} {d.id.slice(0, 8)}
                      </option>
                    ))}
                </select>
              </label>
              <Button icon={UploadCloud} onClick={openImport} disabled={!ws.canPlan || ws.busy}>
                {t('Import data')}
              </Button>
            </div>
            {ws.plans.length > 0 && (
              <label className="plan-select">
                {t('Active forecast')}
                <select
                  aria-label={t('Active forecast')}
                  value={ws.planId}
                  disabled={ws.mode === 'demo' || ws.loading || ws.busy}
                  onChange={(e) => {
                    void ws.refresh(ws.datasetId, e.target.value).catch(() => {})
                  }}
                >
                  {!ws.planId && <option value="">{t('No ready forecast')}</option>}
                  {ws.plans
                    .filter((p) => p.status === 'ready' && p.dataset_id === ws.datasetId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {formatDate(p.created_at)} · {p.id.slice(0, 8)}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {ws.mode === 'demo' && (
              <div className="reset-demo">
                <div>
                  <strong>{t('Restore the demo workspace')}</strong>
                  <p>{t('Reset demo orders, forecasts and activity to their original state.')}</p>
                </div>
                {resetConfirm ? (
                  <div className="reset-actions">
                    <Button
                      variant="danger"
                      onClick={() => {
                        ws.resetDemo()
                        setResetConfirm(false)
                      }}
                    >
                      {t('Confirm reset')}
                    </Button>
                    <Button onClick={() => setResetConfirm(false)}>{t('Keep changes')}</Button>
                  </div>
                ) : (
                  <Button icon={RotateCcw} onClick={() => setResetConfirm(true)}>
                    {t('Reset demo')}
                  </Button>
                )}
              </div>
            )}
          </Panel>
        </div>
        <div className="settings-rail">
          <Panel title={t('Your profile')}>
            <div className="settings-profile">
              <div className="avatar">
                <UserRound size={25} />
              </div>
              <h3>{ws.user.name}</h3>
              <span>{ws.mode === 'demo' ? t('Procurement Manager') : t('Connected workspace member')}</span>
              <Badge status={ws.user.role} />
            </div>
            <div className="permissions-list">
              <div>
                <Check size={14} />
                {t('View inventory and reports')}
              </div>
              <div className={!ws.canPlan ? 'muted' : ''}>
                {ws.canPlan ? <Check size={14} /> : <ShieldCheck size={14} />}
                {t('Import and create forecasts')}
              </div>
              <div className={!ws.canApprove ? 'muted' : ''}>
                {ws.canApprove ? <Check size={14} /> : <ShieldCheck size={14} />}
                {t('Approve purchase orders')}
              </div>
            </div>
          </Panel>
          <Panel title={t('Getting started')}>
            <ol className="getting-started">
              <li>
                <span>1</span>
                <div>
                  <strong>{t('Connect your server')}</strong>
                  <p>{t('Use a personal key issued by your workspace administrator.')}</p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>{t('Import your inventory')}</strong>
                  <p>{t('Upload Excel workbooks or load the supplied datasets.')}</p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>{t('Run a forecast')}</strong>
                  <p>{t('Set your scenario, review the results and create orders.')}</p>
                </div>
              </li>
            </ol>
          </Panel>
          <div className="settings-help">
            <CircleHelp size={16} />
            <p>
              {t(
                'Permissions come from your API key. A planner creates orders; an approver reviews and approves them.',
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
