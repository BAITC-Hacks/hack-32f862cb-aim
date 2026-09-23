import { t, useLanguage } from '../i18n'
import { useState } from 'react'
import type { Explanation } from '../types'
import { formatNumber } from '../lib/format'

export function DemandHistory({ explanation, unit }: { explanation: Explanation; unit: string }) {
  useLanguage()
  const [showAll, setShowAll] = useState(false)
  const raw = explanation.raw_monthly_sales
  const cleaned = new Map(explanation.cleaned_monthly_sales.map((row) => [row.month, row.quantity]))
  const corrections = explanation.outlier_exclusions
  const stockouts = explanation.stockout_adjustments ?? []
  return (
    <section className="detail-section demand-history">
      <h3>{t('Как выделен регулярный спрос')}</h3>
      {raw?.length ? (
        <>
          <p className="detail-note">
            {t('Последние 12 завершённых месяцев,')} {unit}
            {t(
              '. Пропуск отличается от нуля. Столбец «В расчёт» включает очистку всплесков и включённую оценку потерянного спроса.',
            )}
          </p>
          <div className="history-table-scroll">
            <table>
              <caption className="sr-only">{t('Исходные продажи и спрос после обработки')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('Месяц')}</th>
                  <th scope="col">{t('Из Excel')}</th>
                  <th scope="col">{t('В расчёт')}</th>
                  <th scope="col">{t('Изменение')}</th>
                </tr>
              </thead>
              <tbody>
                {raw.slice(-12).map((row) => {
                  const regular = cleaned.get(row.month)
                  const delta = row.quantity == null || regular == null ? null : regular - row.quantity
                  return (
                    <tr key={row.month}>
                      <th scope="row">{row.month.slice(0, 7)}</th>
                      <td>{formatNumber(row.quantity)}</td>
                      <td>{formatNumber(regular)}</td>
                      <td className={delta ? 'history-adjusted' : ''}>
                        {delta == null ? '—' : `${delta > 0 ? '+' : ''}${formatNumber(delta)}`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="detail-note">
          {t(
            'Сохранённый расчёт не содержит исходный месячный ряд. Новый запуск агента сохранит обе версии для сравнения.',
          )}
        </p>
      )}
      <h4>
        {t('Поправки по документам ·')} {corrections.length}
      </h4>
      <p className="detail-note">
        {t(
          'Агент вычитает только избыточную часть разовой продажи после сверки месячного итога. Регулярные крупные покупки сохраняются.',
        )}
      </p>
      {corrections.length ? (
        <>
          <div className="history-corrections">
            {(showAll ? corrections : corrections.slice(0, 10)).map((row, i) => (
              <div key={`${row.document}-${row.date}-${i}`}>
                <strong>{row.document}</strong>
                <span>{row.date}</span>
                <dl>
                  <div>
                    <dt>{t('Количество в документе')}</dt>
                    <dd>
                      {formatNumber(row.original)} {unit}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('Исключено из регулярного спроса')}</dt>
                    <dd>
                      {formatNumber(row.removed)} {unit}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
          {corrections.length > 10 && (
            <button className="text-link" onClick={() => setShowAll((value) => !value)}>
              {showAll ? t('Свернуть') : t`Все поправки (${corrections.length})`}
            </button>
          )}
        </>
      ) : (
        <p className="detail-note">{t('Документных поправок в этом расчёте нет.')}</p>
      )}
      {stockouts.length > 0 && (
        <details className="source-details">
          <summary>
            {t('Оценка потерянного спроса ·')} {stockouts.length} {t('месяцев')}
          </summary>
          <p>{t('Приближение по нулевым месячным снимкам; не подтверждённые потерянные продажи.')}</p>
          <ul>
            {stockouts.map((row) => (
              <li key={row.month}>
                {row.month.slice(0, 7)}: +{formatNumber(row.added)} {unit}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
