import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from 'recharts'
import type { ChartSpec, TableSpec } from './chatClient'
import styles from './ChatViz.module.css'

const COLORS = ['#22c55e', '#06b6d4', '#f59e0b', '#a78bfa', '#f472b6', '#fb923c', '#34d399', '#60a5fa']

const axisTick  = { fontSize: 11, fill: '#6e7681' }
const gridStyle = { stroke: '#21262d', strokeDasharray: '3 3' }
// Smart number formatter for axis ticks and tooltips
function fmtNum(v: unknown): string {
  const n = Number(v)
  if (isNaN(n)) return String(v)
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000)     return `$${(n / 1_000).toFixed(0)}k`
  if (String(v).includes('%') || (Math.abs(n) <= 100 && Math.abs(n) > 0 && Number.isFinite(n / 100)))
    return `${n.toFixed(1)}%`
  return n.toLocaleString()
}

function fmtTick(v: unknown): string {
  const n = Number(v)
  if (isNaN(n)) {
    // Shorten long text labels
    const s = String(v)
    return s.length > 12 ? s.slice(0, 11) + '…' : s
  }
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000)     return `$${(n / 1_000).toFixed(0)}k`
  return String(v)
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean; payload?: { name: string; value: unknown; color: string }[]; label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className={styles.tooltip}>
      {label && <div className={styles.tooltipLabel}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className={styles.tooltipRow}>
          <span className={styles.tooltipDot} style={{ background: p.color }} />
          <span className={styles.tooltipName}>{p.name}</span>
          <span className={styles.tooltipVal}>{fmtNum(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// Detect if values look like dollar amounts or percentages for smarter axis formatting
function detectValueType(_data: Record<string, unknown>[], keys: string[]): 'dollar' | 'pct' | 'count' {
  const key = keys[0] ?? ''
  if (/revenue|profit|expense|cost|rate|price|amount|earn/i.test(key)) return 'dollar'
  if (/margin|pct|percent|rate/i.test(key)) return 'pct'
  return 'count'
}

export function ChatChart({ spec, height = 260 }: { spec: ChartSpec; height?: number }) {
  const { type, xKey, series, data } = spec
  if (!data?.length || !series?.length) return null

  const vtype = detectValueType(data, series.map(s => s.key))
  const yFmt = vtype === 'dollar' ? fmtTick : vtype === 'pct' ? (v: unknown) => `${Number(v).toFixed(1)}%` : undefined

  const commonAxes = (
    <>
      <CartesianGrid {...gridStyle} />
      <XAxis
        dataKey={xKey}
        tick={{ ...axisTick }}
        tickLine={false}
        axisLine={{ stroke: '#30363d' }}
        tickFormatter={v => fmtTick(v)}
        interval="preserveStartEnd"
      />
      <YAxis
        tick={{ ...axisTick }}
        tickLine={false}
        axisLine={false}
        tickFormatter={yFmt ?? fmtTick}
        width={56}
      />
      <Tooltip content={<CustomTooltip />} />
      <Legend
        wrapperStyle={{ fontSize: 11, color: '#8b949e', paddingTop: 8 }}
        iconType="circle"
        iconSize={8}
      />
    </>
  )

  return (
    <div className={styles.vizBox}>
      <ResponsiveContainer width="100%" height={height}>
        {type === 'line' ? (
          <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
            {commonAxes}
            {series.map((s, i) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label ?? s.key}
                stroke={s.color ?? COLORS[i % COLORS.length]}
                strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            ))}
          </LineChart>
        ) : type === 'area' ? (
          <AreaChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
            {commonAxes}
            {series.map((s, i) => {
              const color = s.color ?? COLORS[i % COLORS.length]
              return (
                <Area key={s.key} type="monotone" dataKey={s.key} name={s.label ?? s.key}
                  stroke={color} fill={color} fillOpacity={0.15} strokeWidth={2} dot={false} />
              )
            })}
          </AreaChart>
        ) : type === 'pie' ? (
          <PieChart margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11, color: '#8b949e' }} iconType="circle" iconSize={8} />
            <Pie
              data={data} dataKey={series[0].key} nameKey={xKey}
              cx="50%" cy="45%" outerRadius={height * 0.3} innerRadius={height * 0.12}
              paddingAngle={2}
              label={({ name, percent }) => `${fmtTick(name)} ${(percent * 100).toFixed(0)}%`}
              labelLine={false}
            >
              {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
          </PieChart>
        ) : (
          // bar — default
          <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }} barCategoryGap="30%">
            {commonAxes}
            {series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.label ?? s.key}
                fill={s.color ?? COLORS[i % COLORS.length]}
                radius={[3, 3, 0, 0]}
                maxBarSize={48}
              />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}

// Smart cell formatter
function fmtCell(val: string | number | null): string {
  if (val == null) return '—'
  if (typeof val === 'number') {
    if (Math.abs(val) >= 1000 || val !== Math.floor(val)) {
      // Looks like a dollar amount if large
      if (Math.abs(val) >= 100) return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      return val.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 })
    }
    return String(val)
  }
  return String(val)
}

function isNumericColumn(rows: (string | number | null)[][], colIdx: number): boolean {
  return rows.some(r => typeof r[colIdx] === 'number' && r[colIdx] !== null)
}

export function ChatTable({ spec }: { spec: TableSpec }) {
  if (!spec.columns?.length || !spec.rows?.length) return null
  const numericCols = spec.columns.map((_, i) => isNumericColumn(spec.rows, i))

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {spec.columns.map((c, i) => (
              <th key={i} className={numericCols[i] ? styles.thNum : ''}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.rows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? styles.rowEven : styles.rowOdd}>
              {row.map((cell, ci) => (
                <td key={ci} className={numericCols[ci] ? styles.tdNum : ''}>
                  {fmtCell(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.tableFooter}>{spec.rows.length} rows</div>
    </div>
  )
}
