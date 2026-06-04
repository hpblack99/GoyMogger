import { useMemo } from 'react'
import { useAnalytics } from '../AnalyticsApp'
import { calcPeriodKPIs, fmt } from '../lib/calculations'
import { generateAlerts } from '../lib/alerts'
import { calcEntitySummaries } from '../lib/calculations'
import { useMultiTrend, SERIES_COLORS } from '../lib/useMultiSeries'
import KPICard from '../components/KPICard'
import TrendChart from '../components/TrendChart'
import type { EntityGroup } from '../components/TrendChart'
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

  const { multi, chartData: weekData } = useMultiTrend(filteredLoads, filters, 'week')
  const { chartData: dayData }         = useMultiTrend(filteredLoads, filters, 'day')
  const { chartData: monthData }       = useMultiTrend(filteredLoads, filters, 'month')
  const multiKeys = multi?.keys ?? []

  const marginEntityGroups: EntityGroup[] = multiKeys.map((key, i) => ({
    label: key,
    color: SERIES_COLORS[(i + 1) % SERIES_COLORS.length],
    series: [{ dataKey: `margin_${key}`, name: 'Margin', shape: 'line' as const }],
  }))

  const loadEntityGroups: EntityGroup[] = multiKeys.map((key, i) => ({
    label: key,
    color: SERIES_COLORS[(i + 1) % SERIES_COLORS.length],
    series: [{ dataKey: `loads_${key}`, name: 'Loads', shape: 'line' as const }],
  }))

  const revEntityGroups: EntityGroup[] = multiKeys.map((key, i) => ({
    label: key,
    color: SERIES_COLORS[(i + 1) % SERIES_COLORS.length],
    series: [{ dataKey: `rev_${key}`, name: 'Revenue', shape: 'line' as const }],
  }))

  const profitEntityGroups: EntityGroup[] = multiKeys.map((key, i) => ({
    label: key,
    color: SERIES_COLORS[(i + 1) % SERIES_COLORS.length],
    series: [{ dataKey: `profit_${key}`, name: 'Profit', shape: 'line' as const }],
  }))

  const revGrossSeries = multi
    ? [{ dataKey: 'gross_revenue', name: 'Gross Revenue', color: '#22c55e', shape: 'area' as const, dashed: true }]
    : [{ dataKey: 'revenue',       name: 'Revenue',       color: '#22c55e', shape: 'area' as const }]

  const profitGrossSeries = multi
    ? [{ dataKey: 'gross_profit', name: 'Gross Profit', color: '#a78bfa', shape: 'area' as const, dashed: true }]
    : [{ dataKey: 'profit',       name: 'Profit',       color: '#a78bfa', shape: 'area' as const }]

  const marginGrossSeries = multi
    ? [{ dataKey: 'gross_margin', name: 'Gross Margin', color: '#06b6d4', shape: 'line' as const, dashed: true }]
    : [{ dataKey: 'margin',       name: 'Margin %',     color: '#06b6d4', shape: 'line' as const }]

  const loadGrossSeries = multi
    ? [{ dataKey: 'gross_loadCount', name: 'Gross Loads', color: '#8b5cf6', shape: 'bar' as const, dashed: true }]
    : [{ dataKey: 'loadCount',       name: 'Loads',       color: '#8b5cf6', shape: 'bar' as const }]

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

      <div className={styles.charts}>
        <TrendChart
          title="Revenue by Week"
          weekData={weekData} dayData={dayData} monthData={monthData}
          grossSeries={revGrossSeries}
          entityGroups={revEntityGroups}
          valueType="dollar"
        />
        <TrendChart
          title="Profit by Week"
          weekData={weekData} dayData={dayData} monthData={monthData}
          grossSeries={profitGrossSeries}
          entityGroups={profitEntityGroups}
          valueType="dollar"
        />
        <TrendChart
          title="Margin % by Week"
          weekData={weekData} dayData={dayData} monthData={monthData}
          grossSeries={marginGrossSeries}
          entityGroups={marginEntityGroups}
          valueType="pct"
        />
        <TrendChart
          title="Load Count by Week"
          weekData={weekData} dayData={dayData} monthData={monthData}
          grossSeries={loadGrossSeries}
          entityGroups={loadEntityGroups}
          valueType="count"
        />
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
