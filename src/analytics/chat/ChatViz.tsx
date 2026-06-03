import {
  LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'
import type { ChartSpec, TableSpec } from './chatClient'
import styles from './ChatBot.module.css'

const COLORS = ['#22c55e', '#06b6d4', '#f59e0b', '#a78bfa', '#f472b6', '#fb923c', '#34d399', '#60a5fa']

const axisTick = { fontSize: 10, fill: '#6e7681' }
const tooltipStyle = { background: '#161b22', border: '1px solid #21262d', borderRadius: 8 }

export function ChatChart({ spec, height = 220 }: { spec: ChartSpec; height?: number }) {
  const { type, xKey, series, data } = spec
  if (!data?.length || !series?.length) return null

  const common = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
      <XAxis dataKey={xKey} tick={axisTick} tickLine={false} />
      <YAxis tick={axisTick} tickLine={false} axisLine={false} />
      <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#c9d1d9' }} />
      {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: '#8b949e' }} />}
    </>
  )

  return (
    <div className={styles.vizBox}>
      <ResponsiveContainer width="100%" height={height}>
        {type === 'line' ? (
          <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            {common}
            {series.map((s, i) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label ?? s.key}
                stroke={s.color ?? COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        ) : type === 'area' ? (
          <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            {common}
            {series.map((s, i) => (
              <Area key={s.key} type="monotone" dataKey={s.key} name={s.label ?? s.key}
                stroke={s.color ?? COLORS[i % COLORS.length]} fill={s.color ?? COLORS[i % COLORS.length]} fillOpacity={0.25} strokeWidth={2} />
            ))}
          </AreaChart>
        ) : type === 'pie' ? (
          <PieChart>
            <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#c9d1d9' }} />
            <Legend wrapperStyle={{ fontSize: 11, color: '#8b949e' }} />
            <Pie data={data} dataKey={series[0].key} nameKey={xKey} cx="50%" cy="50%" outerRadius={80} label>
              {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
          </PieChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            {common}
            {series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.label ?? s.key}
                fill={s.color ?? COLORS[i % COLORS.length]} radius={[2, 2, 0, 0]} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}

export function ChatTable({ spec }: { spec: TableSpec }) {
  if (!spec.columns?.length || !spec.rows?.length) return null
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>{spec.columns.map((c, i) => <th key={i}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {spec.rows.map((row, ri) => (
            <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{cell == null ? '' : String(cell)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
