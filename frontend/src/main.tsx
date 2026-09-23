import { t } from './i18n'
import { StrictMode, Component } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import './styles.css'
import './styles-responsive.css'
import './styles-i18n.css'
import App from './App'

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (this.state.failed)
      return (
        <div className="fatal-error">
          <h1>{t("Let's get your workspace back.")}</h1>
          <p>{t('The interface encountered an unexpected error. Reload to try again.')}</p>
          <button className="button button-primary" onClick={() => location.reload()}>
            {t('Reload workspace')}
          </button>
          <button
            className="button"
            onClick={() => {
              localStorage.removeItem('optistock.demo.v1')
              sessionStorage.removeItem('optistock.token')
              localStorage.setItem('optistock.mode', 'demo')
              location.reload()
            }}
          >
            {t('Restore demo workspace')}
          </button>
        </div>
      )
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
