import { t, useLanguage } from '../i18n'
import { useRef, useState } from 'react'
import { Database, FileSpreadsheet, UploadCloud, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useWorkspace } from '../store'
import { Button, Dialog, InlineError } from './ui'

export function ImportDialog({ onClose }: { onClose: () => void }) {
  useLanguage()
  const ws = useWorkspace()
  const navigate = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [supplier, setSupplier] = useState('iek')
  const [date, setDate] = useState('2026-09-22')
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  function addFiles(incoming: File[]) {
    const merged = [...files, ...incoming]
    if (merged.length > 12) {
      setError(t('Select up to 12 Excel files.'))
      return
    }
    if (merged.some((f) => !f.name.toLowerCase().endsWith('.xlsx'))) {
      setError(t('Only .xlsx files are supported.'))
      return
    }
    if (new Set(merged.map((f) => f.name)).size !== merged.length) {
      setError(t('Each file must have a unique name.'))
      return
    }
    if (merged.reduce((n, f) => n + f.size, 0) > 49 * 1024 * 1024) {
      setError(t('Keep the combined file size below 49 MB.'))
      return
    }
    setFiles(merged)
    setError('')
  }
  const submit = async (sample: boolean) => {
    try {
      await ws.importData(sample ? undefined : files, supplier, date)
      onClose()
    } catch {
      /* Workspace displays actionable API errors. */
    }
  }
  return (
    <Dialog
      title={t('Import inventory data')}
      description={t('Bring your products, sales and stock into one workspace.')}
      onClose={() => {
        if (!ws.busy) onClose()
      }}
    >
      {ws.mode === 'demo' ? (
        <div className="connect-prompt">
          <Database size={34} />
          <h3>{t('Connect your workspace')}</h3>
          <p>
            {t(
              'Excel imports are processed by your OptiStock server. Connect it to start working with your own inventory.',
            )}
          </p>
          <Button
            variant="primary"
            onClick={() => {
              onClose()
              navigate('/settings')
            }}
          >
            {t('Open connection settings')}
          </Button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit(false)
          }}
        >
          <div className="form-grid">
            <label>
              {t('Supplier')}
              <select value={supplier} onChange={(e) => setSupplier(e.target.value)} disabled={ws.busy}>
                <option value="iek">IEK</option>
                <option value="systeme">Systeme Electric</option>
              </select>
            </label>
            <label>
              {t('Inventory snapshot date')}
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={ws.busy}
              />
            </label>
          </div>
          <button
            type="button"
            disabled={ws.busy}
            className={`dropzone ${dragging ? 'dragging' : ''}`}
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              if (!ws.busy) addFiles(Array.from(e.dataTransfer.files))
            }}
          >
            <UploadCloud size={30} />
            <strong>{t('Click to upload or drag & drop')}</strong>
            <span>{t('Excel workbooks (.xlsx) · up to 12 files · 49 MB total')}</span>
          </button>
          <input
            ref={input}
            type="file"
            accept=".xlsx"
            multiple
            hidden
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
          <div className="upload-files">
            {files.map((f) => (
              <div key={f.name}>
                <FileSpreadsheet size={18} />
                <span>
                  {f.name}
                  <small>{(f.size / 1024).toFixed(0)} KB</small>
                </span>
                <button
                  type="button"
                  disabled={ws.busy}
                  aria-label={t`Remove ${f.name}`}
                  onClick={() => setFiles((current) => current.filter((x) => x !== f))}
                >
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
          {error && <InlineError message={error} />}
          {ws.busy && (
            <p className="progress-note" role="status">
              {t('Processing:')} {t(ws.job?.progress.stage || 'uploading')}
              {ws.job?.progress.processed != null &&
                ` · ${ws.job.progress.processed} / ${ws.job.progress.total ?? '…'}`}
              {t('. This can take a few minutes.')}
            </p>
          )}
          <div className="dialog-actions">
            <Button type="button" onClick={onClose} disabled={ws.busy}>
              {t('Cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              icon={UploadCloud}
              disabled={!files.length || !ws.canPlan}
              loading={ws.busy}
            >
              {t('Import files ({0})', files.length)}
            </Button>
          </div>
          <div className="sample-import">
            <div>
              <strong>{t('Try the supplied datasets')}</strong>
              <p>{t('Import all 12 IEK and Systeme Electric workbooks.')}</p>
            </div>
            <Button
              type="button"
              icon={Database}
              disabled={ws.busy || !ws.canPlan}
              onClick={() => void submit(true)}
            >
              {t('Load samples')}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  )
}
