import type { Risk } from '../types'

export const formatNumber = (value: number | string | null | undefined) =>
  value == null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(Number(value))
export const formatDate = (value: string) =>
  new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
export const supplierName = (value: string) => ({ iek: 'IEK', systeme: 'Systeme Electric' })[value] || value
export const riskLabels: Record<Risk, string> = {
  critical: 'Critical',
  reorder: 'At Risk',
  covered: 'Healthy',
  insufficient_data: 'No forecast',
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
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}
