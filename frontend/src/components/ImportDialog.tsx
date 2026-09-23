import { useRef, useState } from 'react'
import { Database, FileSpreadsheet, UploadCloud, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useWorkspace } from '../store'
import { Button, Dialog, InlineError } from './ui'

export function ImportDialog({ onClose }: { onClose: () => void }) {
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
      setError('Select up to 12 Excel files.')
      return
    }
    if (merged.some((f) => !f.name.toLowerCase().endsWith('.xlsx'))) {
      setError('Only .xlsx files are supported.')
      return
    }
    if (new Set(merged.map((f) => f.name)).size !== merged.length) {
      setError('Each file must have a unique name.')
      return
    }
    if (merged.reduce((n, f) => n + f.size, 0) > 49 * 1024 * 1024) {
      setError('Keep the combined file size below 49 MB.')
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
      title="Import inventory data"
      description="Bring your products, sales and stock into one workspace."
      onClose={() => {
        if (!ws.busy) onClose()
      }}
    >
      {ws.mode === 'demo' ? (
        <div className="connect-prompt">
          <Database size={34} />
          <h3>Connect your workspace</h3>
          <p>
            Excel imports are processed by your OptiStock server. Connect it to start working with your own
            inventory.
          </p>
          <Button
            variant="primary"
            onClick={() => {
              onClose()
              navigate('/settings')
            }}
          >
            Open connection settings
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
              Supplier
              <select value={supplier} onChange={(e) => setSupplier(e.target.value)} disabled={ws.busy}>
                <option value="iek">IEK</option>
                <option value="systeme">Systeme Electric</option>
              </select>
            </label>
            <label>
              Inventory snapshot date
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
            <strong>Click to upload or drag & drop</strong>
            <span>Excel workbooks (.xlsx) · up to 12 files · 49 MB total</span>
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
                  aria-label={`Remove ${f.name}`}
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
              Processing: {ws.job?.progress.stage || 'uploading'}
              {ws.job?.progress.processed != null &&
                ` · ${ws.job.progress.processed} / ${ws.job.progress.total ?? '…'}`}
              . This can take a few minutes.
            </p>
          )}
          <div className="dialog-actions">
            <Button type="button" onClick={onClose} disabled={ws.busy}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              icon={UploadCloud}
              disabled={!files.length || !ws.canPlan}
              loading={ws.busy}
            >
              Import {files.length || ''} files
            </Button>
          </div>
          <div className="sample-import">
            <div>
              <strong>Try the supplied datasets</strong>
              <p>Import all 12 IEK and Systeme Electric workbooks.</p>
            </div>
            <Button
              type="button"
              icon={Database}
              disabled={ws.busy || !ws.canPlan}
              onClick={() => void submit(true)}
            >
              Load samples
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  )
}
