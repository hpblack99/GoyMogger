import { useMemo, useState } from 'react'
import {
  ComposedChart, Bar, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend
} from 'recharts'
import { useAnalytics } from '../AnalyticsApp'
import { calcTrend, fmt } from '../lib/calculations'
import type { TrendGranularity } from '../lib/calculations'
import styles from './TrendsPage.module.css'

export default function TrendsPage() {
  const { filteredLoads } = useAnalytics()
  const [gran, setGran] = useState<TrendGranularity>('week')
  const trend = useMemo(() => calcTrend(filteredLoads, gran), [filteredLoads, gran])

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Trends</h1>
        <div className={styles.granToggle}>
          {(['day', 'week', 'month'] as TrendGranularity[]).map(g => (
            <button
              key={g}
              className={`${styles.toggleBtn} ${gran === g ? styles.active : ''}`}
              onClick={() => setGran(g)}
            >
              {g.charAt(0).toUpperCase() + g.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.chartCard}>
        <div className={styles.chartTitle}>Revenue &amp; Profit by {gran}</div>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={trend} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
            <XAxis dataKey="period" tick={{ fontSize: 10, fill: '#6e7681' }} tickLine={false} />
            <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#6e7681' }} tickLine={false} axisLine={false}
              tickFormatter={(v: number) => `$${(v/1000).toFixed(0)}k`} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#6e7681' }} tickLine={false} axisLine={false}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
            <Tooltip contentStyle={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8 }}
              labelStyle={{ color: '#c9d1d9' }}
              formatter={(v: number, name: string) => name === 'margin' ? `${v.toFixed(1)}%` : fmt.dollar(v)} />
            <Legend wrapperStyle={{ fontSize: 11, color: '#8b949e' }} />
            <Bar yAxisId="left" dataKey="revenue" name="Revenue" fill="#22c55e" fillOpacity={0.7} radius={[2,2,0,0]} />
            <Bar yAxisId="left" dataKey="profit"  name="Profit"  fill="#06b6d4" fillOpacity={0.7} radius={[2,2,0,0]} />
            <Line yAxisId="right" type="monotone" dataKey="margin" name="margin" stroke="#f59e0b" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className={styles.chartCard}>
        <div className={styles.chartTitle}>Load Count by {gran}</div>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={trend} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
            <XAxis dataKey="period" tick={{ fontSize: 10, fill: '#6e7681' }} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#6e7681' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8 }}
              labelStyle={{ color: '#c9d1d9' }} />
            <Bar dataKey="loadCount" name="Loads" fill="#8b5cf6" radius={[2,2,0,0]} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className={styles.chartCard}>
        <div className={styles.chartTitle}>Revenue &amp; Profit per Load by {gran}</div>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={trend} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
            <XAxis dataKey="period" tick={{ fontSize: 10, fill: '#6e7681' }} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#6e7681' }} tickLine={false} axisLine={false}
              tickFormatter={(v: number) => `$${v.toFixed(0)}`} />
            <Tooltip contentStyle={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8 }}
              labelStyle={{ color: '#c9d1d9' }}
              formatter={(v: number) => fmt.dollar(v)} />
            <Legend wrapperStyle={{ fontSize: 11, color: '#8b949e' }} />
            <Line type="monotone" dataKey="revenuePerLoad" name="Rev/Load"    stroke="#22c55e" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="profitPerLoad"  name="Profit/Load" stroke="#06b6d4" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
