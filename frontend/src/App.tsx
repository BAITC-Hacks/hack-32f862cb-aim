import { lazy } from 'react'
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { WorkspaceProvider } from './store'
import { Layout } from './components/Layout'
import { EmptyState } from './components/ui'

const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })))
const Inventory = lazy(() => import('./pages/Inventory').then((m) => ({ default: m.Inventory })))
const Suppliers = lazy(() => import('./pages/Suppliers').then((m) => ({ default: m.Suppliers })))
const Orders = lazy(() => import('./pages/Orders').then((m) => ({ default: m.Orders })))
const Forecast = lazy(() => import('./pages/Forecast').then((m) => ({ default: m.Forecast })))
const Analytics = lazy(() => import('./pages/Analytics').then((m) => ({ default: m.Analytics })))
const Reports = lazy(() => import('./pages/Reports').then((m) => ({ default: m.Reports })))
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })))

export default function App() {
  return (
    <BrowserRouter>
      <WorkspaceProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="suppliers" element={<Suppliers />} />
            <Route path="orders" element={<Orders />} />
            <Route path="forecast" element={<Forecast />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="reports" element={<Reports />} />
            <Route path="settings" element={<Settings />} />
            <Route
              path="*"
              element={
                <EmptyState
                  title="This page isn't in your workspace"
                  description="Head back to your dashboard to find what you need."
                  action={
                    <Link className="button button-primary" to="/">
                      Back to dashboard
                    </Link>
                  }
                />
              }
            />
          </Route>
        </Routes>
      </WorkspaceProvider>
    </BrowserRouter>
  )
}
