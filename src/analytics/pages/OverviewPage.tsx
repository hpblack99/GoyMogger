import { useMemo } from 'react'
import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend
} from 'recharts'
import { useAnalytics } from '../AnalyticsApp'
import { calcPeriodKPIs, fmt } from '../lib/calculations'
import { generateAlerts } from '../lib/alerts'
import { calcEntitySummaries } from '../lib/calculations'
import { useMultiTrend, SERIES_COLORS } from '../lib/useMultiSeries'
import KPICard from '../components/KPICard'
import styles from './OverviewPage.module.css'

export default function OverviewPage() {
  const { filteredLoads, filters } = useAnalytics()

  const period = useMemo(() =>
    calcPeriodKPIs(filteredLoads, filters.dateFrom, filters.dateTo),
    [filteredLoads, filters]
  )
  const kpis = period.current

  const customerSummaries = useMemo(() =>
    calcEntitySummaries(filteredLoads, 'customer_name'),
    [filteredLoads]
  )
  const alerts = useMemo(() =>
    generateAlerts(filteredLoads, period, customerSummaries),
    [filteredLoads, period, customerSummaries]
  )
  const criticalAlerts = alerts.filter(a => a.severity === 'critical')

  const { multi, chartData } = useMultiTrend(filteredLoads, filters, 'week')
  const multiKeys = multi?.keys ?? []

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Overview</h1>
        <div className={styles.loadCount}>{fmt.num(kpis.loadCount)} loads in period</div>
      </div>

      {criticalAlerts.length > 0 && (
        <div className={styles.alertBanner}>
          ⚠ {criticalAlerts.length} critical alert{criticalAlerts.length > 1 ? 's' : ''}: {criticalAlerts[0].title}
        </div>
      )}

      <div className={styles.kpiGrid}>
        <KPICard label="Revenue"          value={fmt.dollar(kpis.revenue)}        change={period.changes.revenue}        accent />
        <KPICard label="Profit"           value={fmt.dollar(kpis.profit)}         change={period.changes.profit}         />
        <KPICard label="Margin"           value={fmt.pct(kpis.margin)}            change={period.changes.margin}         />
        <KPICard label="Loads"            value={fmt.num(kpis.loadCount)}         change={period.changes.loadCount}      />
        <KPICard label="Revenue / Load"   value={fmt.dollar(kpis.revenuePerLoad)} change={period.changes.revenuePerLoad} />
        <KPICard label="Profit / Load"    value={fmt.dollar(kpis.profitPerLoad)}  change={period.changes.profitPerLoad}  />
        <KPICard label="Active Customers" value={fmt.num(kpis.activeCustomers)}   change={period.changes.activeCustomers}/>
        <KPICard label="Active Reps"      value={fmt.num(kpis.activeSalesReps)}   change={period.changes.activeSalesReps}/>
      </div>

      {/* Charts */}
      <div className={styles.charts}>
        {/* Revenue by Week */}
        <div className={styles.chartCard}>
          <div className={styles.chartTitle}>Revenue by Week</div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
              <XAxis dataKey="period" tick={{ fontSize: 10, fill: '#6e7681' }} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#6e7681' }} tickLine={false} axisLine={false}
                tickFormatter={(v: number) => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8 }}
                labelStyle={{ color: '#c9d1d9' }} formatter={(v: number) => fmt.dollar(v)} />
              {multi ? (
                <>
                  <Area type="monotone" dataKey="gross_revenue" name="Gross" stroke="#22c55e" strokeWidth={2} strokeDasharray="5 3" fill="url(#revGrad)" />
                  {multiKeys.map((key, i) => (
                    <Line key={key} type="monotone" dataKey={`rev_${key}`} name={key} stroke={SERIES_COLORS[(i + 1) % SERIES_COLORS.length]} strokeWidth={1.5} dot={false} />
                  ))}
                  <Legend wrapperStyle={{ fontSize: 11, color: '#6e7681' }} />
                </>
              ) : (
                <Area type="monotone" dataKey="revenue" stroke="#22c55e" strokeWidth={2} fill="url(#revGrad)" />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Profit by Week */}
        <div className={styles.chartCard}>
          <div className={styles.chartTitle}>Profit by Week</div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#a78bfa" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
              <XAxis dataKey="period" tick={{ fontSize: 10, fill: '#6e7681' }} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#6e7681' }} tickLine={false} axisLine={false}
                tickFormatter={(v: number) => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8 }}
                labelStyle={{ color: '#c9d1d9' }} formatter={(v: number) => fmt.dollar(v)} />
              {multi ? (
                <>
                  <Area type="monotone" dataKey="gross_profit" name="Gross" stroke="#a78bfa" strokeWidth={2} strokeDasharray="5 3" fill="url(#profitGrad)" />
                  {multiKeys.map((key, i) => (
                    <Line key={key} type="monotone" dataKey={`profit_${key}`} name={key} stroke={SERIES_COLORS[(i + 1) % SERIES_COLORS.length]} strokeWidth={1.5} dot={false} />
                  ))}
                  <Legend wrapperStyle={{ fontSize: 11, color: '#6e7681' }} />
                </>
              ) : (
                <Area type="monotone" dataKey="profit" stroke="#a78bfa" strokeWidth={2} fill="url(#profitGrad)" />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Margin % by Week */}
        <div className={styles.chartCard}>
          <div className={styles.chartTitle}>Margin % by Week</div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
              <XAxis dataKey="period" tick={{ fontSize: 10, fill: '#6e7681' }} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#6e7681' }} tickLine={false} axisLine={false}
                tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
              <Tooltip contentStyle={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8 }}
                labelStyle={{ color: '#c9d1d9' }} formatter={(v: number) => `${v.toFixed(1)}%`} />
              {multi ? (
                <>
                  <Line type="monotone" dataKey="gross_margin" name="Gross" stroke="#06b6d4" strokeWidth={2} strokeDasharray="5 3" dot={false} />
                  {multiKeys.map((key, i) => (
                    <Line key={key} type="monotone" dataKey={`margin_${key}`} name={key} stroke={SERIES_COLORS[(i + 2) % SERIES_COLORS.length]} strokeWidth={1.5} dot={false} />
                  ))}
                  <Legend wrapperStyle={{ fontSize: 11, color: '#6e7681' }} />
                </>
              ) : (
                <Line type="monotone" dataKey="margin" stroke="#06b6d4" strokeWidth={2} dot={false} />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {alerts.length > 0 && (
        <div className={styles.alertsSection}>
          <div className={styles.sectionTitle}>Active Alerts ({alerts.length})</div>
          <div className={styles.alertList}>
            {alerts.slice(0, 5).map(a => (
              <div key={a.id} className={`${styles.alertItem} ${styles[a.severity]}`}>
                <div className={styles.alertTitle}>{a.title}</div>
                <div className={styles.alertDetail}>{a.detail}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
