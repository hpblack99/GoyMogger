import { useMemo } from 'react'
import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ZAxis } from 'recharts'
import { useAnalytics } from '../AnalyticsApp'
import { calcEntitySummaries, fmt } from '../lib/calculations'
import DataTable from '../components/DataTable'
import type { EntitySummary } from '../lib/types'
import type { Column } from '../components/DataTable'
import styles from './EntityPage.module.css'

const COLS: Column<EntitySummary>[] = [
  { key: 'name',           header: 'Sales Rep' },
  { key: 'loadCount',      header: 'Loads',       align: 'right', render: r => fmt.num(r.loadCount) },
  { key: 'revenue',        header: 'Revenue',      align: 'right', render: r => fmt.dollar(r.revenue) },
  { key: 'profit',         header: 'Profit',       align: 'right', render: r => fmt.dollar(r.profit) },
  { key: 'margin',         header: 'Margin',       align: 'right', render: r => fmt.pct(r.margin) },
  { key: 'revenuePerLoad', header: 'Rev/Load',     align: 'right', render: r => fmt.dollar(r.revenuePerLoad) },
  { key: 'profitPerLoad',  header: 'Profit/Load',  align: 'right', render: r => fmt.dollar(r.profitPerLoad) },
]

export default function SalesRepPage() {
  const { filteredLoads } = useAnalytics()
  const summaries = useMemo(() => calcEntitySummaries(filteredLoads, 'sales_rep'), [filteredLoads])

  const scatterData = summaries.map(s => ({
    name: s.name,
    x: s.loadCount,
    y: s.margin,
    z: s.revenue,
  }))

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Sales Rep Performance</h1>

      <div className={styles.chartCard}>
        <div className={styles.chartTitle}>Load Volume vs Margin % (bubble size = Revenue)</div>
        <ResponsiveContainer width="100%" height={300}>
          <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
            <XAxis dataKey="x" name="Loads" type="number" tick={{ fontSize: 10, fill: '#6e7681' }} tickLine={false}
              label={{ value: 'Load Count', position: 'insideBottom', offset: -4, style: { fill: '#6e7681', fontSize: 10 } }} />
            <YAxis dataKey="y" name="Margin" type="number" tick={{ fontSize: 10, fill: '#6e7681' }} tickLine={false} axisLine={false}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
            <ZAxis dataKey="z" range={[40, 400]} />
            <Tooltip
              contentStyle={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8 }}
              labelStyle={{ color: '#c9d1d9' }}
              cursor={{ strokeDasharray: '3 3' }}
              content={({ payload }) => {
                if (!payload?.length) return null
                const d = payload[0].payload
                return (
                  <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: '8px 12px' }}>
                    <div style={{ color: '#f0f6fc', fontWeight: 600 }}>{d.name}</div>
                    <div style={{ color: '#b1bac4', fontSize: 12 }}>Loads: {d.x}</div>
                    <div style={{ color: '#b1bac4', fontSize: 12 }}>Margin: {d.y?.toFixed(1)}%</div>
                    <div style={{ color: '#b1bac4', fontSize: 12 }}>Revenue: {fmt.dollar(d.z)}</div>
                  </div>
                )
              }}
            />
            <Scatter data={scatterData} fill="#22c55e" fillOpacity={0.7} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      <DataTable columns={COLS} rows={summaries} rowKey={r => r.name} emptyMessage="No sales rep data" />
    </div>
  )
}
