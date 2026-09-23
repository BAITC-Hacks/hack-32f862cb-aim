import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bell,
  Box,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  CircleHelp,
  Database,
  FileText,
  LayoutDashboard,
  Menu,
  Package,
  Plus,
  Search,
  Settings,
  ShoppingCart,
  Sparkles,
  Truck,
  UploadCloud,
  Users,
  X,
} from 'lucide-react'
import { Link, NavLink, Outlet, useNavigate, useOutletContext } from 'react-router-dom'
import { useWorkspace } from '../store'
import { supplierName } from '../lib/format'
import type { Product } from '../types'
import { Badge, Button, IconButton, InlineError, Loading } from './ui'
const ProductDrawer = lazy(() => import('./ProductDrawer').then((m) => ({ default: m.ProductDrawer })))
const ImportDialog = lazy(() => import('./ImportDialog').then((m) => ({ default: m.ImportDialog })))

const navigation = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/inventory', label: 'Inventory', icon: Box },
  { to: '/suppliers', label: 'Suppliers', icon: Users },
  { to: '/orders', label: 'Orders', icon: ShoppingCart },
  { to: '/forecast', label: 'Forecast', icon: ChartNoAxesCombined },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/reports', label: 'Reports', icon: FileText },
]
export interface ShellContext {
  showProduct: (product: Product) => void
  openImport: () => void
}
export function useShell() {
  return useOutletContext<ShellContext>()
}

export function Layout() {
  const ws = useWorkspace()
  const navigate = useNavigate()
  const [product, setProduct] = useState<Product | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [sidebar, setSidebar] = useState(false)
  const [query, setQuery] = useState('')
  const [navQuery, setNavQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const search = useRef<HTMLInputElement>(null)
  const results = ws.products
    .filter((p) =>
      `${p.name} ${p.code} ${supplierName(p.supplier)}`.toLowerCase().includes(query.toLowerCase()),
    )
    .slice(0, 6)
  const critical = ws.products.filter((p) => p.risk === 'critical').length
  const anomalies = ws.products.filter((p) => p.warnings.length).length
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(id)
  }, [])
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        search.current?.focus()
        setSearchOpen(true)
      }
      if (e.key === 'Escape') {
        setSearchOpen(false)
        setNotificationsOpen(false)
        setAddOpen(false)
        setSidebar(false)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])
  const selectProduct = (p: Product) => {
    setProduct(p)
    setSearchOpen(false)
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      {sidebar && (
        <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebar(false)} />
      )}
      <aside className={`sidebar ${sidebar ? 'sidebar-open' : ''}`}>
        <Link to="/" className="brand" aria-label="OptiStock dashboard">
          <svg viewBox="0 0 36 40" fill="none" aria-hidden="true">
            <path d="M18 1 34 10v20L18 39 2 30V10L18 1Z" fill="#f3f4f6" />
            <path d="m18 9 9 5-9 5-9-5 9-5Zm-9 8 7 4v10l-7-4V17Zm18 0v10l-7 4V21l7-4Z" fill="#101215" />
          </svg>
          <span>OptiStock</span>
        </Link>
        <div className="sidebar-search">
          <Search size={16} />
          <input
            aria-label="Search navigation"
            placeholder="Search..."
            value={navQuery}
            onChange={(e) => setNavQuery(e.target.value)}
          />
          <kbd>⌘ K</kbd>
        </div>
        <nav aria-label="Main navigation">
          {navigation
            .filter((n) => n.label.toLowerCase().includes(navQuery.toLowerCase()))
            .map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                onClick={() => setSidebar(false)}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              >
                <Icon size={18} strokeWidth={1.5} />
                <span>{label}</span>
                {label === 'Orders' && ws.orders.filter((o) => o.status === 'draft').length > 0 && (
                  <small>{ws.orders.filter((o) => o.status === 'draft').length}</small>
                )}
              </NavLink>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <NavLink
            to="/settings"
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            onClick={() => setSidebar(false)}
          >
            <Settings size={18} strokeWidth={1.5} />
            <span>Settings</span>
          </NavLink>
          <div className="workspace-card">
            <div className="workspace-card-title">
              <span className={`connection-dot ${ws.mode}`} />
              {ws.mode === 'demo' ? 'Explore your workspace' : 'Workspace connected'}
            </div>
            <p>
              {ws.mode === 'demo'
                ? 'Your next great decision starts with better data.'
                : `${ws.products.length.toLocaleString()} products, one clear picture.`}
            </p>
            <Link to="/settings" aria-label="Workspace settings">
              <ArrowRight size={18} />
            </Link>
          </div>
          <Link to="/settings" className="profile">
            <div className="avatar">
              {ws.user.name
                .split(' ')
                .map((n) => n[0])
                .slice(0, 2)
                .join('')}
            </div>
            <div>
              <strong>{ws.user.name}</strong>
              <span>{ws.mode === 'demo' ? 'Procurement Manager' : ws.user.role}</span>
            </div>
            <ChevronDown size={14} />
          </Link>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <IconButton
            className="mobile-menu"
            icon={Menu}
            label="Open navigation"
            onClick={() => setSidebar(true)}
          />
          <div className="global-search">
            <Search size={17} />
            <input
              ref={search}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setSearchOpen(true)
              }}
              onFocus={() => setSearchOpen(true)}
              aria-label="Global search"
              placeholder="Search for SKU, product, supplier..."
              onKeyDown={(e) => {
                if (e.key === 'Enter' && results[0]) {
                  e.preventDefault()
                  selectProduct(results[0])
                }
              }}
            />
            <kbd>⌘ K</kbd>
            {searchOpen && (
              <>
                <button
                  className="popover-scrim"
                  tabIndex={-1}
                  aria-label="Close search"
                  onClick={() => setSearchOpen(false)}
                />
                <div className="search-results">
                  <div className="popover-title">{query ? 'Search results' : 'Quick access to products'}</div>
                  {results.length ? (
                    results.map((p) => (
                      <button key={p.id} onClick={() => selectProduct(p)}>
                        <span className="search-result-icon">
                          <Package size={17} />
                        </span>
                        <span>
                          <strong>{p.name}</strong>
                          <small>
                            {p.code} · {supplierName(p.supplier)}
                          </small>
                        </span>
                        <Badge status={p.risk} />
                      </button>
                    ))
                  ) : (
                    <p>No products match your search.</p>
                  )}
                  <div className="search-hint">
                    <kbd>Enter</kbd> to open the first result <kbd>Esc</kbd> to close
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="topbar-actions">
            <Link to="/settings" className={`mode-chip ${ws.mode}`}>
              <span className="connection-dot" />
              {ws.mode === 'demo' ? 'Demo workspace' : 'Connected'}
            </Link>
            <div className="popover-anchor">
              <button
                className="icon-button notification-button"
                aria-label="Notifications"
                aria-expanded={notificationsOpen}
                onClick={() => {
                  setNotificationsOpen((v) => !v)
                  setAddOpen(false)
                }}
              >
                <Bell size={20} />
                {critical > 0 && <i />}
              </button>
              {notificationsOpen && (
                <>
                  <button
                    className="popover-scrim"
                    aria-label="Close notifications"
                    onClick={() => setNotificationsOpen(false)}
                  />
                  <div className="notification-popover">
                    <div className="popover-title">Your inventory pulse</div>
                    <button
                      onClick={() => {
                        navigate('/inventory?risk=critical')
                        setNotificationsOpen(false)
                      }}
                    >
                      <span className="icon-tile danger">
                        <Package size={17} />
                      </span>
                      <span>
                        <strong>{critical} products need attention</strong>
                        <small>Review critical stock levels</small>
                      </span>
                      <ArrowRight size={15} />
                    </button>
                    <button
                      onClick={() => {
                        navigate('/analytics')
                        setNotificationsOpen(false)
                      }}
                    >
                      <span className="icon-tile purple">
                        <Activity size={17} />
                      </span>
                      <span>
                        <strong>{anomalies} products have data warnings</strong>
                        <small>Review forecasting assumptions</small>
                      </span>
                      <ArrowRight size={15} />
                    </button>
                    <button
                      onClick={() => {
                        navigate('/orders')
                        setNotificationsOpen(false)
                      }}
                    >
                      <span className="icon-tile blue">
                        <Truck size={17} />
                      </span>
                      <span>
                        <strong>
                          {ws.orders.filter((o) => o.status === 'draft').length} drafts awaiting review
                        </strong>
                        <small>Keep your supply chain moving</small>
                      </span>
                      <ArrowRight size={15} />
                    </button>
                  </div>
                </>
              )}
            </div>
            <div className="topbar-date">
              <CalendarDays size={15} />
              <span>
                {now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
              <span>{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div className="popover-anchor">
              <Button
                variant="primary"
                icon={Plus}
                onClick={() => {
                  setAddOpen((v) => !v)
                  setNotificationsOpen(false)
                }}
                aria-expanded={addOpen}
              >
                Add New
                <ChevronDown size={14} />
              </Button>
              {addOpen && (
                <>
                  <button
                    className="popover-scrim"
                    aria-label="Close add menu"
                    onClick={() => setAddOpen(false)}
                  />
                  <div className="add-menu">
                    <button
                      onClick={() => {
                        setImportOpen(true)
                        setAddOpen(false)
                      }}
                    >
                      <UploadCloud size={17} />
                      Import inventory
                    </button>
                    <button
                      onClick={() => {
                        navigate('/forecast')
                        setAddOpen(false)
                      }}
                    >
                      <Sparkles size={17} />
                      Create forecast
                    </button>
                    <button
                      onClick={() => {
                        navigate('/orders')
                        setAddOpen(false)
                      }}
                    >
                      <ShoppingCart size={17} />
                      Create purchase orders
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          {ws.error && (
            <InlineError
              message={ws.error}
              retry={() => {
                void ws.refresh().catch(() => {})
              }}
            />
          )}
          {ws.busy && (
            <div className="job-banner" role="status">
              <span className="connection-dot live" />
              {ws.job?.status === 'running' || ws.job?.status === 'queued'
                ? `Processing ${ws.job.kind}: ${ws.job.progress.stage || ws.job.status}`
                : 'Saving your changes…'}
              {ws.job?.progress.total != null && (
                <span>
                  {ws.job.progress.processed ?? 0} / {ws.job.progress.total}
                </span>
              )}
            </div>
          )}
          {ws.job?.status === 'failed' && !ws.busy && (
            <InlineError
              message={ws.job.error?.message || 'Processing failed.'}
              retry={() => {
                void ws.retryJob().catch(() => {})
              }}
            />
          )}
          <Suspense fallback={<Loading />}>
            {ws.loading && !ws.products.length ? (
              <Loading />
            ) : (
              <Outlet
                context={
                  { showProduct: setProduct, openImport: () => setImportOpen(true) } satisfies ShellContext
                }
              />
            )}
          </Suspense>
        </main>
        <footer className="app-footer">
          <span>
            <Box size={12} />
            OptiStock <span className="footer-dot">·</span> Smarter inventory. Better decisions.
          </span>
          <Link to="/settings">
            <CircleHelp size={13} />
            Workspace settings
          </Link>
        </footer>
      </div>
      <Suspense fallback={null}>
        {product && <ProductDrawer key={product.id} product={product} onClose={() => setProduct(null)} />}
      </Suspense>
      <Suspense fallback={null}>
        {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
      </Suspense>
      <div className="toast-stack" aria-live="polite">
        {ws.notices.map((n) => (
          <div key={n.id} className={`toast toast-${n.kind}`} role={n.kind === 'error' ? 'alert' : 'status'}>
            {n.kind === 'success' ? <Check size={18} /> : <Database size={18} />}
            <span>{n.message}</span>
            <button onClick={() => ws.dismissNotice(n.id)} aria-label="Dismiss notification">
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
