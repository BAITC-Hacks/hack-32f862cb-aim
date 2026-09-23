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
import { defaultScenario } from '../lib/demo'
import { downloadBlob, errorMessage, formatDate, formatNumber, supplierName } from '../lib/format'
import type { AgentRun, Scenario } from '../types'

const steps = [
  { key: 'validate', title: 'Проверка данных', detail: 'История продаж, остатки и ожидаемые поставки' },
  { key: 'clean', title: 'Регулярный спрос', detail: 'Разовые всплески и оценка потерянных продаж' },
  { key: 'calculate', title: 'Расчёт пополнения', detail: 'Сезонность, рост, сроки и кратность заказа' },
  { key: 'review', title: 'Проверка рисков', detail: 'Объяснения и позиции для внимания менеджера' },
  { key: 'draft', title: 'Заказы поставщикам', detail: 'Черновики с отдельным утверждением менеджера' },
]

export function Agent() {
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
            <Sparkles size={13} /> OPTISTOCK / PROCUREMENT AGENT
          </div>
          <h1>
            От Excel до заказа.
            <br />
            <span>Один запуск агента.</span>
          </h1>
          <p>
            Агент выделит регулярный спрос, учтёт запас и товары в пути, подготовит объяснимые заказы каждому
            поставщику.
          </p>
          <div className="agent-trust">
            <ShieldCheck size={16} /> Вы проверяете и утверждаете. Агент считает и готовит.
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
            <h2>Подключите исходные данные</h2>
            <p>Агент работает с серверным расчётом и Excel. Сейчас открыт демонстрационный каталог.</p>
          </div>
          {ws.localWorkspace ? (
            <Button
              variant="primary"
              onClick={() => void ws.connect('/api/v1', 'local').catch((e) => setError(errorMessage(e)))}
            >
              Подключить локальный сервер
            </Button>
          ) : (
            <Link className="button button-primary" to="/settings">
              Настроить подключение <ArrowRight size={14} />
            </Link>
          )}
        </Panel>
      )}
      {error && <InlineError message={error} />}
      <div className="agent-layout">
        <div className="agent-main">
          <Panel title="Задача агенту" action={<span className="agent-label">Электрокомплект</span>}>
            <p className="agent-intro">
              Рассчитать пополнение и подготовить черновики заказов по поставщикам.
            </p>
            <div className="agent-form-grid">
              <label className="field">
                Набор данных
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
                    Сначала импортируйте Excel
                  </option>
                  {readyDatasets.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.as_of} · {d.summary.items ?? '—'} SKU · {d.id.slice(0, 6)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Поставщик
                <select
                  value={scenario.supplier || ''}
                  disabled={active}
                  onChange={(e) => update('supplier', e.target.value || null)}
                >
                  <option value="">Все поставщики</option>
                  <option value="iek">IEK</option>
                  <option value="systeme">Systeme Electric</option>
                </select>
              </label>
              <label className="field">
                Категория
                <input
                  value={scenario.category ?? ''}
                  disabled={active}
                  onChange={(e) => update('category', e.target.value || null)}
                  placeholder="Все категории (или код из файла)"
                />
              </label>
              <label className="field">
                Срок поставки, дней
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
                Цикл заказа, дней
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
                Страховой запас, дней
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
                Плановый рост, %
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
                  Общий запас поставщика<small>Складской разрез отсутствует в файлах кейса</small>
                </span>
              </div>
            </div>
            <div className="agent-toggles">
              <Toggle
                label="Убирать разовые всплески"
                checked={scenario.remove_outliers}
                onChange={(value) => !active && update('remove_outliers', value)}
              />
              <Toggle
                label="Оценивать потерянный спрос"
                checked={scenario.estimate_stockouts}
                onChange={(value) => !active && update('estimate_stockouts', value)}
              />
              <Toggle
                label="Учитывать сезонность"
                checked={scenario.use_seasonality}
                onChange={(value) => !active && update('use_seasonality', value)}
              />
              <Toggle
                label="Учитывать устойчивый тренд"
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
                {active ? 'Агент выполняет задачу' : 'Запустить агента'}
              </Button>
              <Button icon={FileSpreadsheet} disabled={ws.busy || active || !ws.canPlan} onClick={openImport}>
                Импорт Excel
              </Button>
              {ws.mode === 'live' && !readyDatasets.length && (
                <Button
                  disabled={ws.busy || !ws.canPlan}
                  onClick={() => void ws.importData().catch(() => {})}
                >
                  Загрузить материалы кейса
                </Button>
              )}
            </div>
          </Panel>

          {report?.summary && (
            <>
              <div className="agent-metrics">
                {[
                  ['Товаров проверено', report.summary.items, Database],
                  ['Позиций к заказу', report.summary.order_lines, Truck],
                  ['Разовых всплесков', report.summary.excluded_documents, Sparkles],
                  ['Требуют внимания', report.summary.exception_items, CircleAlert],
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
                title="Результат работы агента"
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
                    Отчёт
                  </Button>
                }
              >
                <div className="agent-tabs" role="tablist" aria-label="Результаты агента">
                  {(
                    [
                      ['orders', 'Заказы'],
                      ['exceptions', 'Требуют внимания'],
                      ['cleaning', 'Разовые всплески'],
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
                              {supplier.order_lines} позиций · {supplier.critical} с риском дефицита
                            </p>
                            <small>
                              {Object.entries(supplier.quantities)
                                .map(([unit, quantity]) => `${formatNumber(quantity)} ${unit}`)
                                .join(' · ')}
                            </small>
                          </div>
                          {order ? (
                            <Link className="button button-secondary" to={`/orders?order=${order.id}`}>
                              Проверить заказ <ArrowRight size={14} />
                            </Link>
                          ) : (
                            <span className="muted">Пополнение не требуется</span>
                          )}
                        </div>
                      )
                    })}
                    <div className="agent-note">
                      <ShieldCheck size={17} />
                      <span>
                        Черновики сохранены в базе. Проверьте остатки и допущения, при необходимости измените
                        количества. Экспорт доступен после утверждения.
                      </span>
                    </div>
                  </div>
                )}
                {tab === 'exceptions' && (
                  <div className="agent-results">
                    <p className="muted">
                      Показаны первые {report.exceptions?.length} из {report.exceptions_total} позиций. Полный
                      список — в каталоге.
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
                          <small>{item.reasons.join(' · ')}</small>
                        </div>
                        <Badge status={item.risk} />
                        <ArrowRight size={16} />
                      </button>
                    ))}
                    {!report.exceptions?.length && <p>Позиции с указанными рисками не обнаружены.</p>}
                  </div>
                )}
                {tab === 'cleaning' && (
                  <div className="agent-results">
                    <p className="muted">
                      Сравнение заказа при одинаковом сценарии: без очистки документов → с очисткой. Разные
                      единицы измерения не суммируются.
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
                            {supplierName(item.supplier)} · {item.documents} документов
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
                          Подтверждённых разовых всплесков для очистки не найдено. Агент сохраняет продажи,
                          если документов недостаточно или месячные итоги не сходятся.
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </Panel>
              <Panel title="Качество и границы данных">
                <div className="agent-coverage">
                  {report.quality &&
                    [
                      ['История продаж', report.quality.with_history],
                      ['Текущий остаток из файла', report.quality.with_current_inventory],
                      ['Детализация продаж', report.quality.with_transactions],
                      ['Товары с поставками в пути', report.quality.with_incoming],
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
                    <li key={text}>{text}</li>
                  ))}
                </ul>
              </Panel>
            </>
          )}
        </div>
        <aside className="agent-side">
          <Panel
            title="Ход выполнения"
            action={
              run ? <Badge status={run.status} /> : <span className="agent-label">Готов к запуску</span>
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
                      <strong>{step.title}</strong>
                      <p>{step.detail}</p>
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
                <InlineError message={run.job.error?.message || 'Не удалось завершить расчёт'} />
                <Button disabled={!ws.canPlan} onClick={() => void retry()}>
                  Повторить задачу
                </Button>
              </div>
            )}
            <div className="agent-note">
              <Clock3 size={16} />
              <span>
                {active
                  ? 'Можно закрыть вкладку: агент продолжит работу на сервере.'
                  : complete
                    ? 'Расчёт завершён. Следующий шаг — проверка менеджером.'
                    : 'Результат и объяснения сохраняются после каждого запуска.'}
              </span>
            </div>
          </Panel>
          {run && (
            <Panel title="Параметры этого запуска">
              <dl className="agent-run-config">
                <div>
                  <dt>Дата данных</dt>
                  <dd>{report?.quality?.as_of || ws.datasets.find((d) => d.id === run.dataset_id)?.as_of}</dd>
                </div>
                <div>
                  <dt>Поставка / цикл / буфер</dt>
                  <dd>
                    {run.scenario.lead_time_days} / {run.scenario.review_days} / {run.scenario.safety_days}{' '}
                    дн.
                  </dd>
                </div>
                <div>
                  <dt>Рост / очистка</dt>
                  <dd>
                    {run.scenario.growth_percent}% / {run.scenario.remove_outliers ? 'вкл.' : 'выкл.'}
                  </dd>
                </div>
              </dl>
            </Panel>
          )}
          <Panel title="История запусков">
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
                        {new Date(item.created_at).toLocaleTimeString('ru', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </small>
                    </span>
                    <Badge status={item.status} />
                  </button>
                ))
              ) : (
                <p className="muted">Здесь появятся сохранённые запуски агента.</p>
              )}
            </div>
          </Panel>
          <div className="agent-engine">
            <Bot size={16} />
            <p>
              Агент выполняет проверяемые расчётные инструменты. Числа и решения доступны в отчёте каждого
              запуска.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
