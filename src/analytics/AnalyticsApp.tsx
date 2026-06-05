import { createContext, useContext, useEffect, useState, useMemo } from 'react'
import { Routes, Route, NavLink, useLocation, Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthGate'
import type { Load, AnalyticsFilters } from './lib/types'
import FilterBar from './components/FilterBar'
import type { OptionGroup } from './components/MultiSelect'
import UploadPage from './pages/UploadPage'
import OverviewPage from './pages/OverviewPage'
import CustomerPage from './pages/CustomerPage'
import SalesRepPage from './pages/SalesRepPage'
import TrendsPage from './pages/TrendsPage'
import MarginLeakagePage from './pages/MarginLeakagePage'
import ChargePage from './pages/ChargePage'
import DiscountPage from './pages/DiscountPage'
import AlertsPage from './pages/AlertsPage'
import BrainstormPage from './pages/BrainstormPage'
import ReportsPage from './pages/ReportsPage'
import ReportEditorPage from './pages/ReportEditorPage'
import ChatBot from './chat/ChatBot'
import FreightAnalyticsLogo from './components/FreightAnalyticsLogo'
import styles from './AnalyticsApp.module.css'

// ── Context ──────────────────────────────────────────────────────────────────

interface AnalyticsCtx {
  allLoads: Load[]
  filteredLoads: Load[]
  filters: AnalyticsFilters
  setFilters: (f: AnalyticsFilters) => void
  loading: boolean
  reload: () => void
  customers: string[]
  salesReps: string[]
  branches: string[]
  customerGroups: OptionGroup[]
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
  null, // divider
  { to: '/analytics/brainstorm',     label: 'Analytics Assistant', icon: '✦' },
  { to: '/analytics/reports',        label: 'Reports',          icon: '⊡' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultFilters(): AnalyticsFilters {
  const to = new Date()
  const from = new Date()
  from.setDate(to.getDate() - 90)
  return {
    dateFrom:  from.toISOString().slice(0, 10),
    dateTo:    to.toISOString().slice(0, 10),
    customers: [],
    salesReps: [],
    branches:  [],
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AnalyticsApp() {
  const { user } = useAuth()
  const location = useLocation()
  const isUpload = location.pathname.endsWith('/upload')
  const isFullPage = ['/brainstorm', '/reports'].some(p => location.pathname.includes(p))

  const [allLoads, setAllLoads]       = useState<Load[]>([])
  const [loading, setLoading]         = useState(true)
  const [loadedCount, setLoadedCount] = useState(0)
  const [filters, setFilters]         = useState<AnalyticsFilters>(defaultFilters)

  const load = async () => {
    setLoading(true)
    setLoadedCount(0)
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
      setLoadedCount(all.length)
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
      if (filters.customers.length > 0 && !filters.customers.includes(l.customer_name ?? '')) return false
      if (filters.salesReps.length > 0 && !filters.salesReps.includes(l.sales_rep ?? ''))     return false
      if (filters.branches.length  > 0 && !filters.branches.includes(l.branch_name ?? ''))    return false
      return true
    })
  }, [allLoads, filters])

  const customers = useMemo(() =>
    [...new Set(allLoads.map(l => l.customer_name).filter(Boolean) as string[])].sort(),
    [allLoads]
  )

  // Fort Worth reps sort first — detect by their most common branch containing "fort worth"
  const salesReps = useMemo(() => {
    const reps = [...new Set(allLoads.map(l => l.sales_rep).filter(Boolean) as string[])]
    const fwReps = new Set(
      allLoads
        .filter(l => /fort.?worth/i.test(l.branch_name ?? ''))
        .map(l => l.sales_rep)
        .filter(Boolean) as string[]
    )
    return [
      ...reps.filter(r => fwReps.has(r)).sort(),
      ...reps.filter(r => !fwReps.has(r)).sort(),
    ]
  }, [allLoads])

  const branches = useMemo(() =>
    [...new Set(allLoads.map(l => l.branch_name).filter(Boolean) as string[])].sort(),
    [allLoads]
  )

  const customerGroups: OptionGroup[] = [
    {
      label: 'Halo Water Systems',
      match: (o) => /halo water|hydronix water/i.test(o),
    },
    {
      label: 'National Door',
      match: (o) => /^(ps garage doors|door pros|garage door supply|blue valley door|western wholesale & supply|western wholesale and supply|overhead door of okc|j ?b garage doors|americas garage doors|voyles overhead door|modoc doors|on-?trak garage door|stabel door|320 ventures|door tech|jmc enterprises|overhead door of jackson|hill country overhead door|victory door|akers door)/i.test(o) || /^national door$/i.test(o),
    },
  ]

  return (
    <Ctx.Provider value={{ allLoads, filteredLoads, filters, setFilters, loading, reload: load, customers, salesReps, branches, customerGroups }}>
      {loading && (
        <div className={styles.loadingOverlay}>
          <div className={styles.loadingBox}>
            <div className={styles.loadingSpinner} />
            <div className={styles.loadingTitle}>Loading freight data…</div>
            {loadedCount > 0 && (
              <div className={styles.loadingCount}>{loadedCount.toLocaleString()} loads fetched</div>
            )}
          </div>
        </div>
      )}
      <div className={styles.shell}>
        {/* Sidebar */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <FreightAnalyticsLogo className={styles.logoImg} />
            <a href="/" className={styles.backLink}>← HankNet</a>
          </div>
          <nav className={styles.sideNav}>
            {NAV.map((n, i) =>
              n === null ? (
                <div key={`div-${i}`} className={styles.navDivider} />
              ) : (
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
              )
            )}
          </nav>
          <div className={styles.sidebarFooter}>
            <span className={styles.userEmail}>{user.email}</span>
            <button className={styles.logoutBtn} onClick={() => supabase.auth.signOut()}>Sign out</button>
          </div>
        </aside>

        {/* Content */}
        <div className={styles.content}>
          {!isUpload && !isFullPage && (
            <div className={styles.filterWrap}>
              <FilterBar
                filters={filters}
                onChange={setFilters}
                customers={customers}
                salesReps={salesReps}
                branches={branches}
                customerGroups={customerGroups}
              />
            </div>
          )}
          <main className={isFullPage ? styles.mainFull : styles.main}>
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
              <Route path="brainstorm"     element={<BrainstormPage />} />
              <Route path="reports"        element={<ReportsPage />} />
              <Route path="reports/:id"    element={<ReportEditorPage />} />
            </Routes>
          </main>
        </div>
      </div>

      {/* Floating AI assistant — persists across all analytics pages */}
      <ChatBot />
    </Ctx.Provider>
  )
}
