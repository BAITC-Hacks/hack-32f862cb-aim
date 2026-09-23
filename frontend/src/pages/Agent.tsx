import { formatDateTime, t, useLanguage } from '../i18n'
import { useEffect, useState } from 'react'
import {
  ArrowRight,
  Bot,
  Check,
  CircleAlert,
  Clock3,
  Database,
  Download,
  FileSpreadsheet,
  LoaderCircle,
  Play,
  ShieldCheck,
  Sparkles,
  Truck,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useWorkspace } from '../store'
import { useShell } from '../components/Layout'
import { Badge, Button, InlineError, Panel, Toggle } from '../components/ui'
import { AssistantPanel } from '../components/AssistantPanel'
import { defaultScenario } from '../lib/demo'
import { downloadBlob, errorMessage, formatDate, formatNumber, supplierName } from '../lib/format'
import { agentStepDetail } from '../i18n/domain'
import type { AgentRun, Scenario } from '../types'

const steps = [
  { key: 'validate', title: 'Проверка данных', detail: 'История продаж, остатки и ожидаемые поставки' },
  { key: 'clean', title: 'Регулярный спрос', detail: 'Разовые всплески и оценка потерянных продаж' },
  { key: 'calculate', title: 'Расчёт пополнения', detail: 'Сезонность, рост, сроки и кратность заказа' },
  { key: 'review', title: 'Проверка рисков', detail: 'Объяснения и позиции для внимания менеджера' },
  { key: 'draft', title: 'Заказы поставщикам', detail: 'Черновики с отдельным утверждением менеджера' },
]

export function Agent() {
  useLanguage()
  const ws = useWorkspace()
  const { openImport, showProduct } = useShell()
  const [scenario, setScenario] = useState<Scenario>({ ...defaultScenario })
  const [datasetId, setDatasetId] = useState('')
  const [runs, setRuns] = useState<AgentRun[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'orders' | 'exceptions' | 'cleaning'>('orders')
  const [refreshKey, setRefreshKey] = useState(0)
  const currentDataset = datasetId || ws.datasetId
  const run = runs.find((r) => r.id === selectedId) ?? runs[0]
  const active = run?.status === 'queued' || run?.status === 'running'
  const complete = run?.status === 'succeeded'
  const canExplain = !ws.loading && ws.planId === run?.plan_id
  const report = run?.report
  const readyDatasets = ws.datasets.filter((d) => d.status === 'ready')
  const update = <K extends keyof Scenario>(key: K, value: Scenario[K]) =>
    setScenario((s) => ({ ...s, [key]: value }))

  useEffect(() => {
    if (ws.mode !== 'live' || !currentDataset) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const response = await ws.api.request<{ items: AgentRun[] }>(
          `/agent/runs?dataset_id=${currentDataset}`,
          { signal: controller.signal },
        )
        if (!controller.signal.aborted) {
          setRuns(response.items)
          setError('')
          if (response.items.some((r) => ['running', 'queued'].includes(r.status)))
            timer = setTimeout(poll, 1500)
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(errorMessage(e))
          timer = setTimeout(poll, 5000)
        }
      }
    }
    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [ws.api, ws.mode, currentDataset, refreshKey])

  useEffect(() => {
    if (!run || run.status !== 'succeeded') return
    void ws.refresh(run.dataset_id, run.plan_id).catch((e) => setError(errorMessage(e)))
    // The run identity is the trigger; workspace refresh updates the context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, run?.status])

  async function start() {
    setError('')
    try {
      const next = await ws.startAgent(scenario, currentDataset)
      setRuns((old) => [next, ...old.filter((r) => r.id !== next.id)])
      setSelectedId(next.id)
      setRefreshKey((k) => k + 1)
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  async function retry() {
    if (!run) return
    try {
      await ws.api.mutate(`/jobs/${run.job.id}/retry`)
      setRefreshKey((k) => k + 1)
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  const stage = run?.job.progress.stage
  const activeStep = stage === 'reviewing' ? 3 : stage === 'calculating' ? 2 : 0
  function explain(itemId: string) {
    if (!canExplain) return
    const product = ws.products.find((p) => p.id === itemId)
    if (product) showProduct(product)
  }
  return (
    <div className="page agent-page">
      <section className="agent-hero">
        <div>
          <div className="eyebrow">
            <Sparkles size={13} /> {t('OPTISTOCK / PROCUREMENT AGENT')}
          </div>
          <h1>
            {t('От Excel до заказа.')}
            <br />
            <span>{t('Один запуск агента.')}</span>
          </h1>
          <p>
            {t(
              'Агент выделит регулярный спрос, учтёт запас и товары в пути, подготовит объяснимые заказы каждому поставщику.',
            )}
          </p>
          <div className="agent-trust">
            <ShieldCheck size={16} /> {t('Вы проверяете и утверждаете. Агент считает и готовит.')}
          </div>
        </div>
        <div className={`agent-orbit ${active ? 'is-active' : ''}`} aria-hidden="true">
          <div>
            <Bot size={48} strokeWidth={1.2} />
          </div>
          <span className="orbit-point one">
            <FileSpreadsheet size={19} />
          </span>
          <span className="orbit-point two">
            <Truck size={19} />
          </span>
          <span className="orbit-point three">
            <Check size={18} />
          </span>
        </div>
      </section>

      {ws.mode === 'demo' && (
        <Panel className="agent-connect">
          <Database size={24} />
          <div>
            <h2>{t('Подключите исходные данные')}</h2>
            <p>{t('Агент работает с серверным расчётом и Excel. Сейчас открыт демонстрационный каталог.')}</p>
          </div>
          {ws.localWorkspace ? (
            <Button
              variant="primary"
              onClick={() => void ws.connect('/api/v1', 'local').catch((e) => setError(errorMessage(e)))}
            >
              {t('Подключить локальный сервер')}
            </Button>
          ) : (
            <Link className="button button-primary" to="/settings">
              {t('Настроить подключение')} <ArrowRight size={14} />
            </Link>
          )}
        </Panel>
      )}
      {error && <InlineError message={error} />}
      <div className="agent-layout">
        <div className="agent-main">
          <Panel title={t('Задача агенту')} action={<span className="agent-label">Электрокомплект</span>}>
            <p className="agent-intro">
              {t('Рассчитать пополнение и подготовить черновики заказов по поставщикам.')}
            </p>
            <div className="agent-form-grid">
              <label className="field">
                {t('Набор данных')}
                <select
                  value={currentDataset}
                  disabled={ws.mode !== 'live' || active}
                  onChange={(e) => {
                    setDatasetId(e.target.value)
                    setSelectedId('')
                    setRuns([])
                    update('category', null)
                  }}
                >
                  <option value="" disabled>
                    {t('Сначала импортируйте Excel')}
                  </option>
                  {readyDatasets.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.as_of} · {d.summary.items ?? '—'} SKU · {d.id.slice(0, 6)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                {t('Поставщик')}
                <select
                  value={scenario.supplier || ''}
                  disabled={active}
                  onChange={(e) => update('supplier', e.target.value || null)}
                >
                  <option value="">{t('Все поставщики')}</option>
                  <option value="iek">IEK</option>
                  <option value="systeme">Systeme Electric</option>
                </select>
              </label>
              <label className="field">
                {t('Категория')}
                <input
                  value={scenario.category ?? ''}
                  disabled={active}
                  onChange={(e) => update('category', e.target.value || null)}
                  placeholder={t('Все категории (или код из файла)')}
                />
              </label>
              <label className="field">
                {t('Срок поставки, дней')}
                <input
                  type="number"
                  min={1}
                  max={180}
                  value={scenario.lead_time_days}
                  disabled={active}
                  onChange={(e) => update('lead_time_days', Number(e.target.value))}
                />
              </label>
              <label className="field">
                {t('Цикл заказа, дней')}
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={scenario.review_days}
                  disabled={active}
                  onChange={(e) => update('review_days', Number(e.target.value))}
                />
              </label>
              <label className="field">
                {t('Страховой запас, дней')}
                <input
                  type="number"
                  min={0}
                  max={90}
                  value={scenario.safety_days}
                  disabled={active}
                  onChange={(e) => update('safety_days', Number(e.target.value))}
                />
              </label>
              <label className="field">
                {t('Плановый рост, %')}
                <input
                  type="number"
                  min={-50}
                  max={200}
                  value={scenario.growth_percent}
                  disabled={active}
                  onChange={(e) => update('growth_percent', Number(e.target.value))}
                />
              </label>
              <div className="agent-scope">
                <Database size={17} />
                <span>
                  {t('Общий запас поставщика')}
                  <small>{t('Складской разрез отсутствует в файлах кейса')}</small>
                </span>
              </div>
            </div>
            <div className="agent-toggles">
              <Toggle
                label={t('Убирать разовые всплески')}
                checked={scenario.remove_outliers}
                onChange={(value) => !active && update('remove_outliers', value)}
              />
              <Toggle
                label={t('Оценивать потерянный спрос')}
                checked={scenario.estimate_stockouts}
                onChange={(value) => !active && update('estimate_stockouts', value)}
              />
              <Toggle
                label={t('Учитывать сезонность')}
                checked={scenario.use_seasonality}
                onChange={(value) => !active && update('use_seasonality', value)}
              />
              <Toggle
                label={t('Учитывать устойчивый тренд')}
                checked={scenario.use_trend}
                onChange={(value) => !active && update('use_trend', value)}
              />
            </div>
            <div className="agent-launch">
              <Button
                variant="primary"
                icon={Play}
                loading={active || ws.busy}
                disabled={ws.mode !== 'live' || !ws.canPlan || !currentDataset || ws.loading}
                onClick={() => void start()}
              >
                {active ? t('Агент выполняет задачу') : t('Запустить агента')}
              </Button>
              <Button icon={FileSpreadsheet} disabled={ws.busy || active || !ws.canPlan} onClick={openImport}>
                {t('Импорт Excel')}
              </Button>
              {ws.mode === 'live' && !readyDatasets.length && (
                <Button
                  disabled={ws.busy || !ws.canPlan}
                  onClick={() => void ws.importData().catch(() => {})}
                >
                  {t('Загрузить материалы кейса')}
                </Button>
              )}
            </div>
          </Panel>

          {report?.summary && (
            <>
              <div className="agent-metrics">
                {[
                  [t('Товаров проверено'), report.summary.items, Database],
                  [t('Позиций к заказу'), report.summary.order_lines, Truck],
                  [t('Разовых всплесков'), report.summary.excluded_documents, Sparkles],
                  [t('Требуют внимания'), report.summary.exception_items, CircleAlert],
                ].map(([label, value, Icon]) => {
                  const MetricIcon = Icon as typeof Database
                  return (
                    <Panel key={String(label)}>
                      <MetricIcon size={18} />
                      <strong>{formatNumber(value as number)}</strong>
                      <span>{String(label)}</span>
                    </Panel>
                  )
                })}
              </div>
              <Panel
                title={t('Результат работы агента')}
                action={
                  <Button
                    variant="ghost"
                    icon={Download}
                    onClick={() =>
                      downloadBlob(
                        new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' }),
                        `optistock-agent-${run.id}.json`,
                      )
                    }
                  >
                    {t('Отчёт')}
                  </Button>
                }
              >
                <div className="agent-tabs" role="tablist" aria-label={t('Результаты агента')}>
                  {(
                    [
                      ['orders', t('Заказы')],
                      ['exceptions', t('Требуют внимания')],
                      ['cleaning', t('Разовые всплески')],
                    ] as const
                  ).map(([key, title]) => (
                    <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
                      {title}
                    </button>
                  ))}
                </div>
                {tab === 'orders' && (
                  <div className="agent-results">
                    {report.suppliers?.map((supplier) => {
                      const order = ws.orders.find(
                        (o) => o.plan_id === run.plan_id && o.supplier === supplier.supplier,
                      )
                      return (
                        <div className="agent-supplier" key={supplier.supplier}>
                          <div className="agent-supplier-icon">
                            <Truck size={21} />
                          </div>
                          <div>
                            <h3>{supplierName(supplier.supplier)}</h3>
                            <p>
                              {t(
                                'Lines: {0} · at risk of shortage: {1}',
                                formatNumber(supplier.order_lines),
                                formatNumber(supplier.critical),
                              )}
                            </p>
                            <small>
                              {Object.entries(supplier.quantities)
                                .map(([unit, quantity]) => `${formatNumber(quantity)} ${unit}`)
                                .join(' · ')}
                            </small>
                          </div>
                          {order ? (
                            <Link className="button button-secondary" to={`/orders?order=${order.id}`}>
                              {t('Проверить заказ')} <ArrowRight size={14} />
                            </Link>
                          ) : (
                            <span className="muted">{t('Пополнение не требуется')}</span>
                          )}
                        </div>
                      )
                    })}
                    <div className="agent-note">
                      <ShieldCheck size={17} />
                      <span>
                        {t(
                          'Черновики сохранены в базе. Проверьте остатки и допущения, при необходимости измените количества. Экспорт доступен после утверждения.',
                        )}
                      </span>
                    </div>
                  </div>
                )}
                {tab === 'exceptions' && (
                  <div className="agent-results">
                    <p className="muted">
                      {t(
                        'Showing {0} of {1} items. The full list is in the catalog.',
                        formatNumber(report.exceptions?.length),
                        formatNumber(report.exceptions_total),
                      )}
                    </p>
                    {report.exceptions?.map((item) => (
                      <button
                        className="agent-exception"
                        key={item.item_id}
                        disabled={!canExplain || !ws.products.some((p) => p.id === item.item_id)}
                        onClick={() => explain(item.item_id)}
                      >
                        <div>
                          <strong>
                            {item.code} <span>{supplierName(item.supplier)}</span>
                          </strong>
                          <p>{item.name}</p>
                          <small>{item.reasons.map((reason) => t(reason)).join(' · ')}</small>
                        </div>
                        <Badge status={item.risk} />
                        <ArrowRight size={16} />
                      </button>
                    ))}
                    {!report.exceptions?.length && <p>{t('Позиции с указанными рисками не обнаружены.')}</p>}
                  </div>
                )}
                {tab === 'cleaning' && (
                  <div className="agent-results">
                    <p className="muted">
                      {t(
                        'Сравнение заказа при одинаковом сценарии: без очистки документов → с очисткой. Разные единицы измерения не суммируются.',
                      )}
                    </p>
                    {report.outlier_comparisons?.map((item) => (
                      <button
                        className="agent-comparison"
                        key={item.item_id}
                        disabled={!canExplain}
                        onClick={() => explain(item.item_id)}
                      >
                        <div>
                          <strong>{item.code}</strong>
                          <small>
                            {supplierName(item.supplier)} · {item.documents} {t('документов')}
                          </small>
                        </div>
                        <span>
                          {formatNumber(item.without_cleaning)} <ArrowRight size={14} />{' '}
                          <b>
                            {formatNumber(item.with_cleaning)} {item.unit}
                          </b>
                        </span>
                      </button>
                    ))}
                    {!report.outlier_comparisons?.length && (
                      <div className="agent-note">
                        <Check size={20} />
                        <span>
                          {t(
                            'Подтверждённых разовых всплесков для очистки не найдено. Агент сохраняет продажи, если документов недостаточно или месячные итоги не сходятся.',
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </Panel>
              <Panel title={t('Качество и границы данных')}>
                <div className="agent-coverage">
                  {report.quality &&
                    [
                      [t('История продаж'), report.quality.with_history],
                      [t('Текущий остаток из файла'), report.quality.with_current_inventory],
                      [t('Детализация продаж'), report.quality.with_transactions],
                      [t('Товары с поставками в пути'), report.quality.with_incoming],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <span>{label}</span>
                        <strong>
                          {value} / {report.quality!.items}
                        </strong>
                        <progress max={report.quality!.items} value={Number(value)} />
                      </div>
                    ))}
                </div>
                <ul className="agent-limitations">
                  {report.limitations?.map((text) => (
                    <li key={text}>{t(text)}</li>
                  ))}
                </ul>
              </Panel>
            </>
          )}
        </div>
        <aside className="agent-side">
          <Panel
            title={t('Ход выполнения')}
            action={
              run ? (
                <Badge status={run.status} />
              ) : (
                <span className="agent-label">{t('Готов к запуску')}</span>
              )
            }
          >
            <ol className="agent-steps" aria-live="polite">
              {(report?.steps ?? steps).map((step, index) => {
                const done = complete || (active && index < activeStep)
                const running = active && index === activeStep
                return (
                  <li key={step.key} className={done ? 'done' : running ? 'running' : ''}>
                    <span className="agent-step-icon">
                      {done ? (
                        <Check size={15} />
                      ) : running ? (
                        <LoaderCircle className="spin" size={15} />
                      ) : (
                        index + 1
                      )}
                    </span>
                    <div>
                      <strong>{t(step.title)}</strong>
                      <p>{agentStepDetail(step, report)}</p>
                      {running && run.job.progress.total && (
                        <small>
                          {run.job.progress.processed ?? 0} / {run.job.progress.total} SKU
                        </small>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
            {run?.status === 'failed' && (
              <div className="agent-failed">
                <InlineError message={run.job.error?.message || t('Не удалось завершить расчёт')} />
                <Button disabled={!ws.canPlan} onClick={() => void retry()}>
                  {t('Повторить задачу')}
                </Button>
              </div>
            )}
            <div className="agent-note">
              <Clock3 size={16} />
              <span>
                {active
                  ? t('Можно закрыть вкладку: агент продолжит работу на сервере.')
                  : complete
                    ? t('Расчёт завершён. Следующий шаг — проверка менеджером.')
                    : t('Результат и объяснения сохраняются после каждого запуска.')}
              </span>
            </div>
          </Panel>
          {run && (
            <Panel title={t('Параметры этого запуска')}>
              <dl className="agent-run-config">
                <div>
                  <dt>{t('Дата данных')}</dt>
                  <dd>{report?.quality?.as_of || ws.datasets.find((d) => d.id === run.dataset_id)?.as_of}</dd>
                </div>
                <div>
                  <dt>{t('Поставка / цикл / буфер')}</dt>
                  <dd>
                    {run.scenario.lead_time_days} / {run.scenario.review_days} / {run.scenario.safety_days}{' '}
                    {t('дн.')}
                  </dd>
                </div>
                <div>
                  <dt>{t('Рост / очистка')}</dt>
                  <dd>
                    {run.scenario.growth_percent}% / {run.scenario.remove_outliers ? t('вкл.') : t('выкл.')}
                  </dd>
                </div>
              </dl>
            </Panel>
          )}
          {run?.plan_id && <AssistantPanel planId={run.plan_id} />}
          <Panel title={t('История запусков')}>
            <div className="agent-history">
              {runs.length ? (
                runs.map((item) => (
                  <button
                    key={item.id}
                    className={run?.id === item.id ? 'selected' : ''}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <span>
                      <strong>#{item.id.slice(0, 8)}</strong>
                      <small>
                        {formatDate(item.created_at)} ·{' '}
                        {formatDateTime(new Date(item.created_at), {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </small>
                    </span>
                    <Badge status={item.status} />
                  </button>
                ))
              ) : (
                <p className="muted">{t('Здесь появятся сохранённые запуски агента.')}</p>
              )}
            </div>
          </Panel>
          <div className="agent-engine">
            <Bot size={16} />
            <p>
              {t(
                'Агент выполняет проверяемые расчётные инструменты. Числа и решения доступны в отчёте каждого запуска.',
              )}
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
