import { useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { useAnalytics } from '../AnalyticsApp'
import { calcEntitySummaries, calcConcentration, fmt } from '../lib/calculations'
import DataTable from '../components/DataTable'
import type { EntitySummary } from '../lib/types'
import type { Column } from '../components/DataTable'
import styles from './EntityPage.module.css'

const COLS: Column<EntitySummary>[] = [
  { key: 'name',           header: 'Customer' },
  { key: 'loadCount',      header: 'Loads',         align: 'right', render: r => fmt.num(r.loadCount) },
  { key: 'revenue',        header: 'Revenue',        align: 'right', render: r => fmt.dollar(r.revenue) },
  { key: 'profit',         header: 'Profit',         align: 'right', render: r => fmt.dollar(r.profit) },
  { key: 'margin',         header: 'Margin',         align: 'right', render: r => fmt.pct(r.margin) },
  { key: 'revenuePerLoad', header: 'Rev/Load',       align: 'right', render: r => fmt.dollar(r.revenuePerLoad) },
  { key: 'profitPerLoad',  header: 'Profit/Load',    align: 'right', render: r => fmt.dollar(r.profitPerLoad) },
]

export default function CustomerPage() {
  const { filteredLoads } = useAnalytics()
  const [view, setView] = useState<'revenue' | 'profit' | 'margin'>('revenue')

  const summaries = useMemo(() => calcEntitySummaries(filteredLoads, 'customer_name'), [filteredLoads])
  const totalRevenue = summaries.reduce((s, x) => s + x.revenue, 0)
  const conc = useMemo(() => calcConcentration(summaries, totalRevenue), [summaries, totalRevenue])
  const top15 = summaries.slice(0, 15)

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Customer Performance</h1>

      <div className={styles.concRow}>
        <div className={styles.concCard}>
          <div className={styles.concLabel}>Top 5 Customer Concentration</div>
          <div className={styles.concValue}>{fmt.pct(conc.top5Pct)}</div>
        </div>
        <div className={styles.concCard}>
          <div className={styles.concLabel}>Top 10 Customer Concentration</div>
          <div className={styles.concValue}>{fmt.pct(conc.top10Pct)}</div>
        </div>
        <div className={styles.concCard}>
          <div className={styles.concLabel}>Total Customers</div>
          <div className={styles.concValue}>{fmt.num(summaries.length)}</div>
        </div>
      </div>

      <div className={styles.viewToggle}>
        {(['revenue', 'profit', 'margin'] as const).map(v => (
          <button
            key={v}
            className={`${styles.toggleBtn} ${view === v ? styles.active : ''}`}
            onClick={() => setView(v)}
          >
            {v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>

      <div className={styles.chartCard}>
        <div className={styles.chartTitle}>Top 15 Customers by {view.charAt(0).toUpperCase() + view.slice(1)}</div>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={top15} layout="vertical" margin={{ top: 4, right: 16, left: 140, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#21262d" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: '#6e7681' }} tickLine={false} axisLine={false}
              tickFormatter={view === 'margin' ? (v: number) => `${v.toFixed(0)}%` : (v: number) => `$${(v/1000).toFixed(0)}k`} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#c9d1d9' }} tickLine={false} axisLine={false} width={135} />
            <Tooltip contentStyle={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8 }}
              labelStyle={{ color: '#c9d1d9' }} itemStyle={{ color: '#22c55e' }}
              formatter={(v: number) => view === 'margin' ? `${v.toFixed(1)}%` : fmt.dollar(v)} />
            <Bar dataKey={view} fill="#22c55e" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <DataTable columns={COLS} rows={summaries} rowKey={r => r.name} emptyMessage="No customer data" />
    </div>
  )
}
