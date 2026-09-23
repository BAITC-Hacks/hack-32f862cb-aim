import { Languages } from 'lucide-react'
import { isLanguage, languages, setLanguage, t, useLanguage } from '../i18n'

export function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const language = useLanguage()
  return (
    <label className={`language-selector ${compact ? 'language-selector-compact' : ''}`}>
      <Languages size={16} aria-hidden="true" />
      <span className={compact ? 'sr-only' : ''}>{t('Interface language')}</span>
      <select
        value={language}
        onChange={(event) => {
          if (isLanguage(event.target.value)) setLanguage(event.target.value)
        }}
      >
        {languages.map(({ code, name }) => (
          <option key={code} value={code} lang={code}>
            {name}
          </option>
        ))}
      </select>
    </label>
  )
}
