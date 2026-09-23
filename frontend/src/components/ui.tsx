import { useEffect, useRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { ArrowRight, Check, CircleAlert, LoaderCircle, Search, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { riskLabels } from '../lib/format'
import type { Risk } from '../types'

export function Button({
  children,
  variant = 'secondary',
  icon: Icon,
  loading,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  icon?: LucideIcon
  loading?: boolean
}) {
  return (
    <button
      {...props}
      className={`button button-${variant} ${className}`}
      disabled={props.disabled || loading}
    >
      {loading ? <LoaderCircle size={15} className="spin" /> : Icon && <Icon size={15} />}
      {children}
    </button>
  )
}
export function IconButton({
  icon: Icon,
  label,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return (
    <button {...props} className={`icon-button ${props.className ?? ''}`} aria-label={label} title={label}>
      <Icon size={19} />
    </button>
  )
}
export function Badge({ status }: { status: Risk | string }) {
  const labels: Record<string, string> = {
    ...riskLabels,
    draft: 'Draft',
    approved: 'Approved',
    cancelled: 'Cancelled',
    ready: 'Ready',
    failed: 'Failed',
    queued: 'Queued',
    running: 'Processing',
  }
  return <span className={`badge badge-${status}`}>{labels[status] ?? status}</span>
}
export function Panel({
  title,
  action,
  children,
  className = '',
}: {
  title?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <div className="panel-heading">
          <h2>{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}
export function TextLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button className="text-link" onClick={onClick}>
      {children}
      <ArrowRight size={15} />
    </button>
  )
}
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string
  title: ReactNode
  description: string
  action?: ReactNode
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <div className="page-actions">{action}</div>}
    </div>
  )
}
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search products...',
  label = 'Search products',
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  label?: string
}) {
  return (
    <div className="search-input">
      <Search size={15} />
      <input
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button aria-label="Clear search" onClick={() => onChange('')}>
          <X size={13} />
        </button>
      )}
    </div>
  )
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <Search size={27} />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  )
}
export function Loading({ text = 'Loading workspace...' }: { text?: string }) {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle size={22} className="spin" />
      <span>{text}</span>
    </div>
  )
}
export function InlineError({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="inline-error" role="alert">
      <CircleAlert size={18} />
      <span>{message}</span>
      {retry && <Button onClick={retry}>Retry</Button>}
    </div>
  )
}
export function Dialog({
  title,
  description,
  children,
  onClose,
  drawer = false,
  wide = false,
}: {
  title: string
  description?: string
  children: ReactNode
  onClose: () => void
  drawer?: boolean
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    const previous = document.activeElement as HTMLElement | null
    dialog.showModal()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      dialog.close()
      document.body.style.overflow = overflow
      previous?.focus()
    }
  }, [])
  return (
    <dialog
      ref={ref}
      className={`dialog ${drawer ? 'drawer' : ''} ${wide ? 'dialog-wide' : ''}`}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const rect = e.currentTarget.getBoundingClientRect()
          if (
            e.clientX < rect.left ||
            e.clientX > rect.right ||
            e.clientY < rect.top ||
            e.clientY > rect.bottom
          )
            onClose()
        }
      }}
      aria-label={title}
    >
      <div className="dialog-header">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <IconButton icon={X} label="Close dialog" onClick={onClose} />
      </div>
      <div className="dialog-content">{children}</div>
    </dialog>
  )
}
export function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track">
        <Check size={12} />
      </span>
    </label>
  )
}
