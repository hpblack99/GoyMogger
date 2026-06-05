import { useMemo } from 'react'
import { calcKPIs, calcWeeklyKpiSeries, pctChange, fmt } from '../lib/calculations'
import { GROSS_COLORS } from '../lib/useMultiSeries'
import type { Load, KPIs } from '../lib/types'
import Sparkline from './Sparkline'
import styles from './KpiDashboard.module.css'

type MetricFormat = 'dollar' | 'pct' | 'count'

const METRIC_META: Record<keyof KPIs, { label: string; format: MetricFormat; color: string }> = {
  loadCount:       { label: 'Total Loads',    format: 'count',  color: GROSS_COLORS.loads },
  revenue:         { label: 'Total Revenue',  format: 'dollar', color: GROSS_COLORS.revenue },
  cost:            { label: 'Total Expense',  format: 'dollar', color: '#fb923c' },
  profit:          { label: 'Total GP',       format: 'dollar', color: GROSS_COLORS.profit },
  margin:          { label: 'Avg Margin',     format: 'pct',    color: GROSS_COLORS.margin },
  revenuePerLoad:  { label: 'Rev / Load',     format: 'dollar', color: GROSS_COLORS.revPerLoad },
  profitPerLoad:   { label: 'GP / Load',      format: 'dollar', color: GROSS_COLORS.profitPerLoad },
  activeCustomers: { label: 'Customers',      format: 'count',  color: '#60a5fa' },
  activeSalesReps: { label: 'Sales Reps',     format: 'count',  color: '#e879f9' },
  activeCarriers:  { label: 'Active Carriers', format: 'count', color: '#2dd4bf' },
}

const DEFAULT_METRICS: (keyof KPIs)[] = [
  'loadCount', 'revenue', 'cost', 'profit', 'margin', 'revenuePerLoad', 'profitPerLoad', 'activeCarriers',
]

export interface LeadingCard {
  label: string
  value: number
  format: MetricFormat
  series?: number[]
  color?: string
}

interface Props {
  /** Loads to aggregate the dashboard over (already filtered by the page). */
  loads: Load[]
  /** Optional title shown above the grid (e.g. "Dashboard"). */
  title?: string
  /** Custom cards rendered before the standard KPI cards. */
  leadingCards?: LeadingCard[]
  /** Which standard KPIs to show, in order. Defaults to the full financial set. */
  metrics?: (keyof KPIs)[]
}

function formatVal(v: number, format: MetricFormat): string {
  if (format === 'dollar') return fmt.dollar(v)
  if (format === 'pct')    return fmt.pct(v)
  return fmt.num(Math.round(v))
}

/** Week-over-week change chip: latest complete week vs the prior week. */
function WoWChip({ series }: { series: number[] }) {
  if (!series || series.length < 2) {
    return <div className={styles.wowFlat}>—</div>
  }
  const last = series[series.length - 1]
  const prev = series[series.length - 2]
  const pct = pctChange(last, prev)
  if (!isFinite(pct) || pct === 0) {
    return <div className={styles.wowFlat}>0.0% WoW</div>
  }
  const up = pct > 0
  return (
    <div className={up ? styles.wowUp : styles.wowDown}>
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}% WoW
    </div>
  )
}

function Card({ label, value, format, sparkSeries, wowSeries, color }: {
  label: string; value: number; format: MetricFormat
  sparkSeries: number[]; wowSeries: number[]; color: string
}) {
  return (
    <div className={styles.card}>
      <div className={styles.cardLabel}>{label}</div>
      <div className={styles.cardValue}>{formatVal(value, format)}</div>
      <WoWChip series={wowSeries} />
      <div className={styles.spark}>
        <Sparkline data={sparkSeries} color={color} />
      </div>
    </div>
  )
}

/** Index (exclusive) up to which weeks are fully elapsed as of today. */
function completeWeekCount(weekKeys: string[]): number {
  const todayIso = new Date().toISOString().slice(0, 10)
  let count = 0
  for (const wk of weekKeys) {
    const end = new Date(wk + 'T00:00:00')
    end.setDate(end.getDate() + 6)
    if (end.toISOString().slice(0, 10) <= todayIso) count++
  }
  return count
}

export default function KpiDashboard({ loads, title = 'Dashboard', leadingCards = [], metrics = DEFAULT_METRICS }: Props) {
  const totals = useMemo(() => calcKPIs(loads), [loads])
  const weekly = useMemo(() => calcWeeklyKpiSeries(loads), [loads])

  // Trailing week is usually partial (dateTo defaults to today) — exclude it from
  // the week-over-week comparison so deltas reflect complete weeks only.
  const completeCount = useMemo(() => completeWeekCount(weekly.map(w => w.week)), [weekly])

  return (
    <div className={styles.section}>
      <div className={styles.sectionLabel}>{title}</div>
      <div className={styles.grid}>
        {leadingCards.map(c => {
          const spark = c.series ?? []
          // Leading-card series share the same weekly buckets, so the same
          // complete-week cutoff applies; fall back to full series if misaligned.
          const wow = spark.length === weekly.length ? spark.slice(0, completeCount) : spark
          return (
            <Card key={c.label} label={c.label} value={c.value} format={c.format}
              sparkSeries={spark} wowSeries={wow} color={c.color ?? '#8b949e'} />
          )
        })}
        {metrics.map(key => {
          const meta = METRIC_META[key]
          const spark = weekly.map(w => w.kpis[key])
          return (
            <Card key={key} label={meta.label} value={totals[key]} format={meta.format}
              sparkSeries={spark} wowSeries={spark.slice(0, completeCount)} color={meta.color} />
          )
        })}
      </div>
    </div>
  )
}
