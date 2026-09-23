import { useSyncExternalStore } from 'react'
import { messages } from './messages'
import { extraMessages } from './extra'
import { errorMessages } from './errors'

export type Language = 'en' | 'ru' | 'kk'
export const languages: { code: Language; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'ru', name: 'Русский' },
  { code: 'kk', name: 'Қазақша' },
]
export const languageStorageKey = 'optistock.language'
const locales: Record<Language, string> = { en: 'en-US', ru: 'ru-RU', kk: 'kk-KZ' }
const columns: Record<Language, number> = { en: 0, ru: 1, kk: 2 }
const listeners = new Set<() => void>()
const aliases = new Map<string, readonly [string, string, string]>()
const catalog = { ...messages, ...extraMessages, ...errorMessages }
for (const row of Object.values(catalog))
  for (const value of row) if (!aliases.has(value)) aliases.set(value, row)

export function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'ru' || value === 'kk'
}

function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem(languageStorageKey)
    if (isLanguage(saved)) return saved
  } catch {
    /* Private browser settings can make storage unavailable. */
  }
  const preferred = navigator.language.split('-')[0]
  return isLanguage(preferred) ? preferred : 'en'
}

let language: Language = initialLanguage()
export function getLocale() {
  return locales[language]
}

// Some Chromium builds ship incomplete Kazakh ICU data. Kazakh uses the same
// decimal/group separators as Russian; choose that numeric locale consistently.
export function getNumberLocale() {
  return language === 'kk' ? 'ru-RU' : locales[language]
}

const kazakhMonths = [
  'қаң.',
  'ақп.',
  'нау.',
  'сәу.',
  'мам.',
  'мау.',
  'шіл.',
  'там.',
  'қыр.',
  'қаз.',
  'қар.',
  'жел.',
]

export function formatDateTime(date: Date, options: Intl.DateTimeFormatOptions) {
  if (language !== 'kk') return new Intl.DateTimeFormat(getLocale(), options).format(date)
  // All UI dates use local time, abbreviated months and optional hours/minutes.
  // Use ICU for numeric parts and substitute Kazakh month names instead of M01…M12.
  const parts = new Intl.DateTimeFormat('ru-RU', options).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)?.value
  const month = options.month === 'short' ? kazakhMonths[date.getMonth()] : part('month')
  const calendar = [options.year ? `${part('year')} ж.` : '', part('day'), month].filter(Boolean).join(' ')
  const time = [part('hour'), part('minute'), part('second')].filter(Boolean).join(':')
  return [calendar, time].filter(Boolean).join(', ')
}

/** Plain source keys or tagged templates; interpolated values stay unchanged. */
export function t(key: string | TemplateStringsArray, ...values: unknown[]): string {
  const source =
    typeof key === 'string' ? key : key.reduce((text, part, i) => text + (i ? `{${i - 1}}` : '') + part, '')
  const row = catalog[source] ?? aliases.get(source)
  const translated = row?.[columns[language]] ?? source
  return translated.replace(/\{(\d+)\}/g, (placeholder, index: string) =>
    Number(index) < values.length ? String(values[Number(index)] ?? '') : placeholder,
  )
}

function updateDocument() {
  document.documentElement.lang = language
  document.title = t('OptiStock — Inventory planning')
}
updateDocument()

export function setLanguage(next: Language) {
  if (!isLanguage(next)) return
  try {
    localStorage.setItem(languageStorageKey, next)
  } catch {
    /* Keep switching available in memory. */
  }
  if (language === next) return
  language = next
  updateDocument()
  listeners.forEach((listener) => listener())
}

function onStorage(event: StorageEvent) {
  if (event.key !== languageStorageKey) return
  const next = isLanguage(event.newValue) ? event.newValue : initialLanguage()
  if (next === language) return
  language = next
  updateDocument()
  listeners.forEach((listener) => listener())
}
function subscribe(listener: () => void) {
  if (!listeners.size) window.addEventListener('storage', onStorage)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (!listeners.size) window.removeEventListener('storage', onStorage)
  }
}
export function useLanguage() {
  return useSyncExternalStore(subscribe, () => language)
}
