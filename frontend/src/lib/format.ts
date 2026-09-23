import { getNumberLocale, formatDateTime, t } from '../i18n'
import type { Risk } from '../types'

export const formatNumber = (value: number | string | null | undefined) =>
  value == null
    ? '—'
    : new Intl.NumberFormat(getNumberLocale(), { maximumFractionDigits: 1 }).format(Number(value))
export const formatDate = (value: string) =>
  formatDateTime(new Date(value), { month: 'short', day: 'numeric', year: 'numeric' })
export const supplierName = (value: string) => ({ iek: 'IEK', systeme: 'Systeme Electric' })[value] || value
export const riskLabels: Record<Risk, string> = {
  get critical() {
    return t('Critical')
  },
  get reorder() {
    return t('At Risk')
  },
  get covered() {
    return t('Healthy')
  },
  get insufficient_data() {
    return t('No forecast')
  },
}
export const shortId = (id: string) => (id.startsWith('PO-') ? id : `PO-${id.slice(0, 8).toUpperCase()}`)
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function csvBlob(rows: unknown[][]) {
  const escape = (value: unknown) => {
    let text = String(value ?? '')
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`
    return `"${text.replaceAll('"', '""')}"`
  }
  return new Blob(['\uFEFF', rows.map((row) => row.map(escape).join(';')).join('\r\n')], {
    type: 'text/csv;charset=utf-8',
  })
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? t(error.message) : t('Something went wrong. Please try again.')
}
