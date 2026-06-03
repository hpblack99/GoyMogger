import { useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts'
import { useAnalytics } from '../AnalyticsApp'
import { calcEntitySummaries, fmt, safeDiv } from '../lib/calculations'
import DataTable from '../components/DataTable'
import type { EntitySummary } from '../lib/types'
import type { Column } from '../components/DataTable'
import styles from './MarginLeakagePage.module.css'

export default function MarginLeakagePage() {
  const { filteredLoads } = useAnalytics()

  const lowestMarginCustomers = useMemo(() => {
    const s = calcEntitySummaries(filteredLoads, 'customer_name')
    return [...s].sort((a, b) => a.margin - b.margin).slice(0, 20)
  }, [filteredLoads])

  const lowestMarginReps = useMemo(() => {
    const s = calcEntitySummaries(filteredLoads, 'sales_rep')
    return [...s].sort((a, b) => a.margin - b.margin).slice(0, 15)
  }, [filteredLoads])

  const lowestMarginLanes = useMemo(() => {
    const byLane: Record<string, { revenue: number; profit: number; count: number }> = {}
    filteredLoads.forEach(l => {
      if (!l.pickup_state || !l.drop_state) return
      const key = `${l.pickup_state} → ${l.drop_state}`
      if (!byLane[key]) byLane[key] = { revenue: 0, profit: 0, count: 0 }
      byLane[key].revenue += l.load_revenue ?? 0
      byLane[key].profit  += l.load_profit  ?? 0
      byLane[key].count   += 1
    })
    return Object.entries(byLane)
      .map(([lane, { revenue, profit, count }]) => ({
        lane,
        revenue,
        profit,
        margin: safeDiv(profit, revenue) * 100,
        count,
      }))
      .filter(x => x.count >= 3)
      .sort((a, b) => a.margin - b.margin)
      .slice(0, 15)
  }, [filteredLoads])

  const custCols: Column<EntitySummary>[] = [
    { key: 'name',      header: 'Customer' },
    { key: 'loadCount', header: 'Loads',   align: 'right', render: r => fmt.num(r.loadCount) },
    { key: 'revenue',   header: 'Revenue', align: 'right', render: r => fmt.dollar(r.revenue) },
    { key: 'margin',    header: 'Margin',  align: 'right', render: r => (
      <span style={{ color: r.margin < 10 ? 'var(--color-error-500)' : r.margin < 15 ? 'var(--color-warning-500)' : undefined }}>
        {fmt.pct(r.margin)}
      </span>
    )},
  ]

  type LaneRow = { lane: string; revenue: number; profit: number; margin: number; count: number }
  const laneCols: Column<LaneRow>[] = [
    { key: 'lane',    header: 'Lane' },
    { key: 'count',   header: 'Loads',   align: 'right' },
    { key: 'revenue', header: 'Revenue', align: 'right', render: r => fmt.dollar(r.revenue) },
    { key: 'margin',  header: 'Margin',  align: 'right', render: r => (
      <span style={{ color: r.margin < 10 ? 'var(--color-error-500)' : r.margin < 15 ? 'var(--color-warning-500)' : undefined }}>
        {fmt.pct(r.margin)}
      </span>
    )},
  ]

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Margin Leakage</h1>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Lowest Margin Customers (min 1 load)</div>
        <div className={styles.chartCard}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={lowestMarginCustomers} layout="vertical" margin={{ top: 4, right: 16, left: 160, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#21262d" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#6e7681' }} tickLine={false} axisLine={false}
                tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#c9d1d9' }} tickLine={false} axisLine={false} width={155} />
              <Tooltip contentStyle={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8 }}
                labelStyle={{ color: '#c9d1d9' }}
                formatter={(v: number) => `${v.toFixed(1)}%`} />
              <Bar dataKey="margin" radius={[0, 4, 4, 0]}>
                {lowestMarginCustomers.map((e, i) => (
                  <Cell key={i} fill={e.margin < 10 ? '#f85149' : e.margin < 15 ? '#f59e0b' : '#22c55e'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <DataTable columns={custCols} rows={lowestMarginCustomers} rowKey={r => r.name} maxRows={10} />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Lowest Margin Lanes (min 3 loads)</div>
        <DataTable columns={laneCols} rows={lowestMarginLanes} rowKey={r => r.lane} emptyMessage="Not enough lane data" />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Lowest Margin Reps</div>
        <DataTable columns={[
          { key: 'name',    header: 'Rep' },
          { key: 'loadCount', header: 'Loads', align: 'right', render: (r: EntitySummary) => fmt.num(r.loadCount) },
          { key: 'revenue', header: 'Revenue', align: 'right', render: (r: EntitySummary) => fmt.dollar(r.revenue) },
          { key: 'margin',  header: 'Margin',  align: 'right', render: (r: EntitySummary) => (
            <span style={{ color: r.margin < 10 ? 'var(--color-error-500)' : r.margin < 15 ? 'var(--color-warning-500)' : undefined }}>
              {fmt.pct(r.margin)}
            </span>
          )},
        ] as Column<EntitySummary>[]} rows={lowestMarginReps} rowKey={r => r.name} />
      </div>
    </div>
  )
}
