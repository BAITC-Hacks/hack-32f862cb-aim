import { t, formatDateTime, useLanguage } from '../i18n'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, CircleAlert, Sparkles, Wrench } from 'lucide-react'
import { useWorkspace } from '../store'
import { errorMessage, formatNumber } from '../lib/format'
import type { AssistantRun, AssistantStatus, Job } from '../types'
import { Badge, Button, InlineError, Panel } from './ui'

type Task = 'risks' | 'explain' | 'what_if'

const stageLabels: Record<string, string> = {
  preparing_ai_facts: 'Готовим проверяемые факты',
  waiting_for_openai: 'Ждём ответ OpenAI',
  running_ai_tools: 'Работают инструменты сервера',
}

function Facts({ run }: { run: AssistantRun }) {
  useLanguage()
  const facts = run.result.facts
  if (!facts) return null
  const rows = facts.order_quantities_by_supplier_and_unit ?? []
  return (
    <div className="assistant-facts">
      <h4>{t('Проверяемые числа сервера')}</h4>
      <table>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.supplier}-${row.unit}`}>
              <th scope="row">
                {row.supplier} · {row.unit}
              </th>
              <td>{formatNumber(row.before)}</td>
              {facts.task === 'what_if' && <td>→ {formatNumber(row.after)}</td>}
            </tr>
          ))}
          <tr>
            <th scope="row">{t('Products')}</th>
            <td colSpan={2}>
              {formatNumber(facts.items_total)} · {facts.as_of} · {facts.algorithm_version}
            </td>
          </tr>
        </tbody>
      </table>
      <details>
        <summary>{t('Ограничения ответа')}</summary>
        <ul>
          {(facts.limitations ?? []).map((line) => (
            <li key={line}>{t(line)}</li>
          ))}
        </ul>
      </details>
    </div>
  )
}

function ToolCalls({ run }: { run: AssistantRun }) {
  useLanguage()
  const calls = run.result.tool_calls ?? []
  if (!calls.length) return null
  return (
    <div className="assistant-tools">
      <h4>
        <Wrench size={14} /> {t('Инструменты, которые вызвала модель')}
      </h4>
      <ol>
        {calls.map((call, index) => (
          <li key={`${call.name}-${index}`} className={call.ok ? '' : 'failed'}>
            <code>{call.name}</code>
            <small>{call.arguments === '{}' ? '' : call.arguments}</small>
            {!call.ok && <span className="assistant-tool-error">{t('Вызов отклонён сервером')}</span>}
          </li>
        ))}
      </ol>
    </div>
  )
}

export function AssistantPanel({
  planId,
  itemId,
  itemCode,
  defaultTask = 'risks',
}: {
  planId: string
  itemId?: string
  itemCode?: string
  defaultTask?: Task
}) {
  useLanguage()
  const ws = useWorkspace()
  const [status, setStatus] = useState<AssistantStatus | null>(null)
  const [runs, setRuns] = useState<AssistantRun[]>([])
  const [run, setRun] = useState<AssistantRun | null>(null)
  const [task, setTask] = useState<Task>(defaultTask)
  const [question, setQuestion] = useState('')
  const [leadTime, setLeadTime] = useState<number>(ws.scenario.lead_time_days)
  const [safetyDays, setSafetyDays] = useState<number>(ws.scenario.safety_days)
  const [growth, setGrowth] = useState<number>(ws.scenario.growth_percent)
  const [job, setJob] = useState<Job | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  const live = ws.mode === 'live'

  const loadHistory = useCallback(
    (signal?: AbortSignal) =>
      ws.api
        .request<{ items: AssistantRun[] }>(`/assistant/runs?plan_id=${planId}&limit=10`, { signal })
        .then((history) => {
          setRuns(history.items)
          setRun((current) => current ?? history.items.find((item) => item.status === 'ready') ?? null)
        }),
    [ws.api, planId],
  )

  useEffect(() => {
    if (!live || !planId) return
    const abort = new AbortController()
    ws.api
      .request<AssistantStatus>('/assistant/status', { signal: abort.signal })
      .then(setStatus)
      .catch(() => setStatus(null))
    loadHistory(abort.signal).catch(() => undefined)
    return () => {
      abort.abort()
      controller.current?.abort()
    }
  }, [live, planId, ws.api, loadHistory])

  async function ask() {
    setBusy(true)
    setError('')
    setJob(null)
    const abort = new AbortController()
    controller.current = abort
    try {
      const body: Record<string, unknown> = { plan_id: planId, task }
      if (question.trim()) body.question = question.trim()
      if (task === 'explain') body.item_id = itemId
      if (task === 'what_if')
        body.scenario = {
          ...ws.scenario,
          lead_time_days: leadTime,
          safety_days: safetyDays,
          growth_percent: growth,
        }
      const started = await ws.api.mutate<{ run_id: string; job_id: string }>('/assistant/runs', body)
      await ws.api.waitForJob(started.job_id, setJob, abort.signal)
      const finished = await ws.api.request<AssistantRun>(`/assistant/runs/${started.run_id}`)
      setRun(finished)
      await loadHistory()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
      setJob(null)
    }
  }

  const disabled = !live || !planId || !status?.configured || busy || !ws.canPlan
  const stage = job?.progress?.stage
  return (
    <Panel
      title={t('AI-ассистент')}
      className="assistant-panel"
      action={
        status?.model ? <span className="agent-label">{t('Модель: {0}', status.model)}</span> : undefined
      }
    >
      <p className="muted assistant-intro">
        <Sparkles size={14} />{' '}
        {t('Вопросы по сохранённому расчёту. Числа берутся с сервера, модель их только объясняет.')}
      </p>

      {!live && (
        <p className="assistant-note">
          <CircleAlert size={14} /> {t('Подключите сервер, чтобы задать вопрос AI.')}{' '}
          {t('В деморежиме ответы AI не генерируются.')}
        </p>
      )}
      {live && status && !status.configured && (
        <p className="assistant-note">
          <CircleAlert size={14} /> {t('OpenAI не настроен на сервере. Планирование работает без него.')}
        </p>
      )}
      {live && !planId && (
        <p className="assistant-note">
          <CircleAlert size={14} /> {t('Сначала выполните расчёт: у ассистента должен быть готовый план.')}
        </p>
      )}

      <div className="assistant-tasks" role="group" aria-label={t('AI-ассистент')}>
        {(
          [
            ['risks', 'Риски и следующие шаги'],
            ['explain', 'Объяснить товар'],
            ['what_if', 'Сравнить сценарий'],
          ] as [Task, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={task === key ? 'selected' : ''}
            disabled={key === 'explain' && !itemId}
            onClick={() => setTask(key)}
          >
            {t(label)}
          </button>
        ))}
      </div>

      {task === 'explain' && (
        <p className="muted assistant-target">
          {itemCode
            ? `${t('Товар для объяснения')}: ${itemCode}`
            : t('Выберите товар в таблице или откройте карточку SKU.')}
        </p>
      )}

      {task === 'what_if' && (
        <div className="assistant-scenario">
          <label>
            {t('Срок поставки, дн.')}
            <input
              type="number"
              min={1}
              max={180}
              value={leadTime}
              onChange={(e) => setLeadTime(Number(e.target.value))}
            />
          </label>
          <label>
            {t('Страховой запас, дн.')}
            <input
              type="number"
              min={0}
              max={90}
              value={safetyDays}
              onChange={(e) => setSafetyDays(Number(e.target.value))}
            />
          </label>
          <label>
            {t('Рост, %')}
            <input
              type="number"
              min={-50}
              max={200}
              value={growth}
              onChange={(e) => setGrowth(Number(e.target.value))}
            />
          </label>
          <p className="muted">{t('Сравнение гипотетическое: активный план и заказы не меняются.')}</p>
        </div>
      )}

      <label className="assistant-question">
        <span>{t('Вопрос')}</span>
        <textarea
          rows={3}
          maxLength={2000}
          value={question}
          disabled={disabled}
          placeholder={t(
            'Спросите, почему предложено такое количество, или что изменится при другом сроке поставки.',
          )}
          onChange={(e) => setQuestion(e.target.value)}
        />
      </label>

      <div className="assistant-actions">
        <Button variant="primary" icon={Bot} loading={busy} disabled={disabled} onClick={() => void ask()}>
          {t('Спросить AI')}
        </Button>
        {status && (
          <small className="muted">{t('Лимит: {0} вопросов в час', status.requests_per_hour)}</small>
        )}
      </div>

      {busy && <p className="assistant-stage">{t(stageLabels[stage ?? ''] ?? 'Ждём ответ OpenAI')}</p>}
      {error && <InlineError message={error} retry={() => void ask()} />}

      {run?.result?.answer && (
        <article className="assistant-answer">
          <h4>{t('Ответ модели')}</h4>
          {run.result.answer
            .split('\n')
            .map((line, index) => (line.trim() ? <p key={index}>{line}</p> : <br key={index} />))}
          <p className="muted assistant-usage">
            {t(
              'Шагов: {0} · вызовов инструментов: {1} · токенов: {2}',
              run.result.steps ?? 0,
              run.result.tool_calls?.length ?? 0,
              run.result.usage?.total_tokens ?? 0,
            )}
          </p>
          <ToolCalls run={run} />
          <Facts run={run} />
          <p className="muted">{t('Модель не рассчитывает и не утверждает заказы.')}</p>
        </article>
      )}

      {status?.tools?.length ? (
        <details className="assistant-registry">
          <summary>{t('Доступные инструменты')}</summary>
          <ul>
            {status.tools.map((tool) => (
              <li key={tool.name}>
                <code>{tool.name}</code> — {tool.description}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="assistant-history">
        <h4>{t('История вопросов')}</h4>
        {runs.length ? (
          <ul>
            {runs.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={run?.id === item.id ? 'selected' : ''}
                  onClick={() => setRun(item)}
                >
                  <span>{item.request?.question?.slice(0, 70) || t('Риски и следующие шаги')}</span>
                  <small>
                    {formatDateTime(new Date(item.created_at), { hour: '2-digit', minute: '2-digit' })}
                  </small>
                </button>
                <Badge status={item.status === 'ready' ? 'succeeded' : item.status} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{t('Здесь появятся сохранённые ответы ассистента.')}</p>
        )}
      </div>
    </Panel>
  )
}
