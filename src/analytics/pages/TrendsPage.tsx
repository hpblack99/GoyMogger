import { useState } from 'react'
import {
  ComposedChart, Bar, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend
} from 'recharts'
import { useAnalytics } from '../AnalyticsApp'
import { fmt } from '../lib/calculations'
import type { TrendGranularity } from '../lib/calculations'
import { useMultiTrend, SERIES_COLORS } from '../lib/useMultiSeries'
import styles from './TrendsPage.module.css'

export default function TrendsPage() {
  const { filteredLoads, filters } = useAnalytics()
  const [gran, setGran] = useState<TrendGranularity>('week')

  const { multi, chartData } = useMultiTrend(filteredLoads, filters, gran)
  const multiKeys = multi?.keys ?? []

  const granLabel = gran.charAt(0).toUpperCase() + gran.slice(1)

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

      {/* Revenue & Profit */}
      <div className={styles.chartCard}>
        <div className={styles.chartTitle}>Revenue &amp; Profit by {granLabel}</div>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
            <XAxis dataKey="period" tick={{ fontSize: 10, fill: '#6e7681' }} tickLine={false} />
            <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#6e7681' }} tickLine={false} axisLine={false}
              tickFormatter={(v: number) => `$${(v/1000).toFixed(0)}k`} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#6e7681' }} tickLine={false} axisLine={false}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
            <Tooltip contentStyle={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8 }}
              labelStyle={{ color: '#c9d1d9' }}
              formatter={(v: number, name: string) => name.startsWith('margin') || name.startsWith('Margin') ? `${v.toFixed(1)}%` : fmt.dollar(v)} />
            <Legend wrapperStyle={{ fontSize: 11, color: '#8b949e' }} />
            {multi ? (
              <>
                <Bar  yAxisId="left"  dataKey="gross_revenue" name="Rev (Gross)"    fill="#22c55e" fillOpacity={0.4} radius={[2,2,0,0]} />
                <Bar  yAxisId="left"  dataKey="gross_profit"  name="Profit (Gross)" fill="#06b6d4" fillOpacity={0.4} radius={[2,2,0,0]} />
                <Line yAxisId="right" type="monotone" dataKey="gross_margin" name="Margin (Gross)" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 3" dot={false} />
                {multiKeys.map((key, i) => {
                  const c = SERIES_COLORS[(i + 2) % SERIES_COLORS.length]
                  return [
                    <Line key={`rev_${key}`}    yAxisId="left"  type="monotone" dataKey={`rev_${key}`}    name={`Rev – ${key}`}    stroke={c} strokeWidth={1.5} dot={false} />,
                    <Line key={`profit_${key}`} yAxisId="left"  type="monotone" dataKey={`profit_${key}`} name={`Profit – ${key}`} stroke={c} strokeWidth={1.5} dot={false} strokeDasharray="3 2" />,
                    <Line key={`margin_${key}`} yAxisId="right" type="monotone" dataKey={`margin_${key}`} name={`Margin – ${key}`} stroke={c} strokeWidth={1}   dot={false} strokeDasharray="1 3" />,
                  ]
                })}
              </>
            ) : (
              <>
                <Bar  yAxisId="left"  dataKey="revenue" name="Revenue" fill="#22c55e" fillOpacity={0.7} radius={[2,2,0,0]} />
                <Bar  yAxisId="left"  dataKey="profit"  name="Profit"  fill="#06b6d4" fillOpacity={0.7} radius={[2,2,0,0]} />
                <Line yAxisId="right" type="monotone" dataKey="margin" name="margin" stroke="#f59e0b" strokeWidth={2} dot={false} />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Load Count */}
      <div className={styles.chartCard}>
        <div className={styles.chartTitle}>Load Count by {granLabel}</div>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
            <XAxis dataKey="period" tick={{ fontSize: 10, fill: '#6e7681' }} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#6e7681' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8 }}
              labelStyle={{ color: '#c9d1d9' }} />
            <Legend wrapperStyle={{ fontSize: 11, color: '#8b949e' }} />
            {multi ? (
              <>
                <Bar dataKey="gross_loadCount" name="Loads (Gross)" fill="#8b5cf6" fillOpacity={0.4} radius={[2,2,0,0]} />
                {multiKeys.map((key, i) => (
                  <Line key={key} type="monotone" dataKey={`loads_${key}`} name={key} stroke={SERIES_COLORS[(i + 1) % SERIES_COLORS.length]} strokeWidth={1.5} dot={false} />
                ))}
              </>
            ) : (
              <Bar dataKey="loadCount" name="Loads" fill="#8b5cf6" radius={[2,2,0,0]} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Rev & Profit per Load */}
      <div className={styles.chartCard}>
        <div className={styles.chartTitle}>Revenue &amp; Profit per Load by {granLabel}</div>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
            <XAxis dataKey="period" tick={{ fontSize: 10, fill: '#6e7681' }} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#6e7681' }} tickLine={false} axisLine={false}
              tickFormatter={(v: number) => `$${v.toFixed(0)}`} />
            <Tooltip contentStyle={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8 }}
              labelStyle={{ color: '#c9d1d9' }} formatter={(v: number) => fmt.dollar(v)} />
            <Legend wrapperStyle={{ fontSize: 11, color: '#8b949e' }} />
            {multi ? (
              <>
                <Line type="monotone" dataKey="gross_revenuePerLoad"  name="Rev/Load (Gross)"    stroke="#22c55e" strokeWidth={2} strokeDasharray="5 3" dot={false} />
                <Line type="monotone" dataKey="gross_profitPerLoad"   name="Profit/Load (Gross)" stroke="#06b6d4" strokeWidth={2} strokeDasharray="5 3" dot={false} />
                {multiKeys.map((key, i) => {
                  const c = SERIES_COLORS[(i + 2) % SERIES_COLORS.length]
                  return [
                    <Line key={`rpl_${key}`} type="monotone" dataKey={`revPerLoad_${key}`}    name={`Rev/Load – ${key}`}    stroke={c} strokeWidth={1.5} dot={false} />,
                    <Line key={`ppl_${key}`} type="monotone" dataKey={`profitPerLoad_${key}`} name={`Profit/Load – ${key}`} stroke={c} strokeWidth={1.5} dot={false} strokeDasharray="3 2" />,
                  ]
                })}
              </>
            ) : (
              <>
                <Line type="monotone" dataKey="revenuePerLoad" name="Rev/Load"    stroke="#22c55e" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="profitPerLoad"  name="Profit/Load" stroke="#06b6d4" strokeWidth={2} dot={false} />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
