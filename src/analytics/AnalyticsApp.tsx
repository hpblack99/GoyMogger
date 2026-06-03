import { createContext, useContext, useEffect, useState, useMemo } from 'react'
import { Routes, Route, NavLink, useLocation, Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Load, AnalyticsFilters } from './lib/types'
import FilterBar from './components/FilterBar'
import UploadPage from './pages/UploadPage'
import OverviewPage from './pages/OverviewPage'
import CustomerPage from './pages/CustomerPage'
import SalesRepPage from './pages/SalesRepPage'
import TrendsPage from './pages/TrendsPage'
import MarginLeakagePage from './pages/MarginLeakagePage'
import ChargePage from './pages/ChargePage'
import DiscountPage from './pages/DiscountPage'
import AlertsPage from './pages/AlertsPage'
import styles from './AnalyticsApp.module.css'

// ── Context ──────────────────────────────────────────────────────────────────

interface AnalyticsCtx {
  allLoads: Load[]
  filteredLoads: Load[]
  filters: AnalyticsFilters
  setFilters: (f: AnalyticsFilters) => void
  loading: boolean
  reload: () => void
}

const Ctx = createContext<AnalyticsCtx>(null!)
export const useAnalytics = () => useContext(Ctx)

// ── Sidebar nav items ─────────────────────────────────────────────────────────

const NAV = [
  { to: '/analytics/upload',         label: 'Upload Data',      icon: '⬆' },
  { to: '/analytics/overview',       label: 'Overview',         icon: '▦' },
  { to: '/analytics/customers',      label: 'Customers',        icon: '◉' },
  { to: '/analytics/sales-reps',     label: 'Sales Reps',       icon: '◈' },
  { to: '/analytics/trends',         label: 'Trends',           icon: '∿' },
  { to: '/analytics/margin-leakage', label: 'Margin Leakage',   icon: '⚠' },
  { to: '/analytics/charges',        label: 'Charges',          icon: '⊞' },
  { to: '/analytics/discounts',      label: 'Discounts',        icon: '⊟' },
  { to: '/analytics/alerts',         label: 'Alerts',           icon: '◎' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultFilters(): AnalyticsFilters {
  const to = new Date()
  const from = new Date()
  from.setDate(to.getDate() - 90)
  return {
    dateFrom: from.toISOString().slice(0, 10),
    dateTo:   to.toISOString().slice(0, 10),
    customer:  '',
    salesRep:  '',
    branch:    '',
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AnalyticsApp() {
  const location = useLocation()
  const isUpload = location.pathname.endsWith('/upload')

  const [allLoads, setAllLoads] = useState<Load[]>([])
  const [loading, setLoading]   = useState(true)
  const [filters, setFilters]   = useState<AnalyticsFilters>(defaultFilters)

  const load = async () => {
    setLoading(true)
    const PAGE = 1000
    const all: Load[] = []
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from('loads')
        .select('*')
        .order('booked_date', { ascending: false })
        .range(from, from + PAGE - 1)
      if (error || !data || data.length === 0) break
      all.push(...(data as Load[]))
      if (data.length < PAGE) break
      from += PAGE
    }
    setAllLoads(all)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filteredLoads = useMemo(() => {
    return allLoads.filter(l => {
      if (filters.dateFrom && l.booked_date && l.booked_date < filters.dateFrom) return false
      if (filters.dateTo   && l.booked_date && l.booked_date > filters.dateTo)   return false
      if (filters.customer  && l.customer_name !== filters.customer)  return false
      if (filters.salesRep  && l.sales_rep     !== filters.salesRep)  return false
      if (filters.branch    && l.branch_name   !== filters.branch)    return false
      return true
    })
  }, [allLoads, filters])

  const customers = useMemo(() =>
    [...new Set(allLoads.map(l => l.customer_name).filter(Boolean) as string[])].sort(),
    [allLoads]
  )
  const salesReps = useMemo(() =>
    [...new Set(allLoads.map(l => l.sales_rep).filter(Boolean) as string[])].sort(),
    [allLoads]
  )
  const branches = useMemo(() =>
    [...new Set(allLoads.map(l => l.branch_name).filter(Boolean) as string[])].sort(),
    [allLoads]
  )

  return (
    <Ctx.Provider value={{ allLoads, filteredLoads, filters, setFilters, loading, reload: load }}>
      <div className={styles.shell}>
        {/* Sidebar */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <span className={styles.toolName}>Freight Analytics</span>
            <a href="/" className={styles.backLink}>← HankNet</a>
          </div>
          <nav className={styles.sideNav}>
            {NAV.map(n => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  `${styles.navItem} ${isActive ? styles.navActive : ''}`
                }
              >
                <span className={styles.navIcon}>{n.icon}</span>
                {n.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <div className={styles.content}>
          {!isUpload && (
            <div className={styles.filterWrap}>
              <FilterBar
                filters={filters}
                onChange={setFilters}
                customers={customers}
                salesReps={salesReps}
                branches={branches}
              />
            </div>
          )}
          <main className={styles.main}>
            {loading && !isUpload && (
              <div className={styles.loadingBar}>Loading data…</div>
            )}
            <Routes>
              <Route index element={<Navigate to="overview" replace />} />
              <Route path="upload"         element={<UploadPage />} />
              <Route path="overview"       element={<OverviewPage />} />
              <Route path="customers"      element={<CustomerPage />} />
              <Route path="sales-reps"     element={<SalesRepPage />} />
              <Route path="trends"         element={<TrendsPage />} />
              <Route path="margin-leakage" element={<MarginLeakagePage />} />
              <Route path="charges"        element={<ChargePage />} />
              <Route path="discounts"      element={<DiscountPage />} />
              <Route path="alerts"         element={<AlertsPage />} />
            </Routes>
          </main>
        </div>
      </div>
    </Ctx.Provider>
  )
}
