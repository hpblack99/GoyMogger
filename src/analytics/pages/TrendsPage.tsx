import { useState, useMemo } from 'react'
import {
  ComposedChart, Area, Line, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { useAnalytics } from '../AnalyticsApp'
import type { TrendGranularity } from '../lib/calculations'
import { fmt } from '../lib/calculations'
import { useMultiTrend, ENTITY_COLORS, GROSS_COLORS } from '../lib/useMultiSeries'
import styles from './TrendsPage.module.css'

// ── KPI definitions ───────────────────────────────────────────────────────────

type KpiId = 'revenue' | 'profit' | 'margin' | 'loadCount'

interface KpiDef {
  id: KpiId
  label: string
  axis: 'left' | 'right' | 'count'
  grossKey: string
  entityPrefix: string
  format: 'dollar' | 'pct' | 'count'
  shape: 'area' | 'line' | 'bar'
}

const KPIS: KpiDef[] = [
  { id: 'revenue',   label: 'Revenue',   axis: 'left',  grossKey: 'revenue',   entityPrefix: 'rev',    format: 'dollar', shape: 'area' },
  { id: 'profit',    label: 'Profit',    axis: 'left',  grossKey: 'profit',    entityPrefix: 'profit', format: 'dollar', shape: 'area' },
  { id: 'margin',    label: 'Margin %',  axis: 'right', grossKey: 'margin',    entityPrefix: 'margin', format: 'pct',    shape: 'line' },
  { id: 'loadCount', label: 'Loads',     axis: 'count', grossKey: 'loadCount', entityPrefix: 'loads',  format: 'count',  shape: 'bar'  },
]

const KPI_COLOR: Record<KpiId, string> = {
  revenue:   GROSS_COLORS.revenue,
  profit:    GROSS_COLORS.profit,
  margin:    GROSS_COLORS.margin,
  loadCount: GROSS_COLORS.loads,
}

// Dash pattern to distinguish KPIs sharing an entity color
const KPI_DASH: Record<KpiId, string | undefined> = {
  revenue:   undefined,   // solid
  profit:    '6 3',       // long-dash
  margin:    '2 4',       // dotted
  loadCount: undefined,   // bar — no dash needed
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const axisTick = { fontSize: 10, fill: '#6e7681' }
const gridProps = { strokeDasharray: '3 3' as const, stroke: '#21262d' }
const ttStyle = { background: '#161b22', border: '1px solid #30363d', borderRadius: 8, fontSize: 12 }
const ttLabel = { color: '#c9d1d9', fontWeight: 600 }

function fmtVal(v: number, format: KpiDef['format']) {
  if (format === 'dollar') return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  if (format === 'pct')    return `${v.toFixed(1)}%`
  return String(Math.round(v))
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TrendsPage() {
  const { filteredLoads, filters } = useAnalytics()
  const [gran, setGran]           = useState<TrendGranularity>('week')
  const [activeKpis, setActiveKpis]         = useState<Set<KpiId>>(new Set(['revenue', 'profit', 'margin', 'loadCount']))
  const [activeEntities, setActiveEntities] = useState<Set<string>>(new Set())

  const { multi, chartData: weekData }  = useMultiTrend(filteredLoads, filters, 'week')
  const { chartData: dayData }          = useMultiTrend(filteredLoads, filters, 'day')
  const { chartData: monthData }        = useMultiTrend(filteredLoads, filters, 'month')

  const data      = gran === 'day' ? dayData : gran === 'month' ? monthData : weekData
  const multiKeys = multi?.keys ?? []

  const toggleKpi    = (id: KpiId)   => setActiveKpis(p    => { const n = new Set(p);    n.has(id)  ? n.delete(id)  : n.add(id);  return n })
  const toggleEntity = (key: string) => setActiveEntities(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n })

  const visibleEntities = multiKeys.filter(k => activeEntities.has(k))
  const hasEntities     = visibleEntities.length > 0

  // Map dataKey → format for tooltip
  const keyFormat = useMemo<Record<string, KpiDef['format']>>(() => {
    const map: Record<string, KpiDef['format']> = {}
    for (const kpi of KPIS) {
      const gk = multi ? `gross_${kpi.grossKey}` : kpi.grossKey
      map[gk] = kpi.format
      for (const ek of multiKeys) map[`${kpi.entityPrefix}_${ek}`] = kpi.format
    }
    return map
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multi, multiKeys.join(',')])

  // Build chart series
  const series = useMemo<React.ReactNode[]>(() => {
    const nodes: React.ReactNode[] = []

    for (const kpi of KPIS) {
      if (!activeKpis.has(kpi.id)) continue

      const gk    = multi ? `gross_${kpi.grossKey}` : kpi.grossKey
      const color = KPI_COLOR[kpi.id]
      const fade  = hasEntities

      // Gross / total series
      if (kpi.shape === 'area') {
        const gradId = `grad-${kpi.id}`
        nodes.push(
          <defs key={`defs-${kpi.id}`}>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={color} stopOpacity={fade ? 0.06 : 0.28} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
        )
        nodes.push(
          <Area key={gk} yAxisId={kpi.axis} type="monotone" dataKey={gk}
            name={multi ? `${kpi.label} (Total)` : kpi.label}
            stroke={color} strokeWidth={fade ? 1.5 : 2.5}
            strokeDasharray={fade ? '4 3' : undefined}
            fill={`url(#${gradId})`} dot={false} />
        )
      } else if (kpi.shape === 'bar') {
        nodes.push(
          <Bar key={gk} yAxisId={kpi.axis} dataKey={gk}
            name={multi ? `${kpi.label} (Total)` : kpi.label}
            fill={color} fillOpacity={fade ? 0.22 : 0.65}
            radius={[2,2,0,0]} maxBarSize={fade ? 18 : 32} />
        )
      } else {
        nodes.push(
          <Line key={gk} yAxisId={kpi.axis} type="monotone" dataKey={gk}
            name={multi ? `${kpi.label} (Total)` : kpi.label}
            stroke={color} strokeWidth={fade ? 1.5 : 2.5}
            strokeDasharray={fade ? '4 3' : undefined} dot={false} />
        )
      }

      // Per-entity overlay series
      for (let ei = 0; ei < multiKeys.length; ei++) {
        const ek     = multiKeys[ei]
        if (!visibleEntities.includes(ek)) continue

        const dk     = `${kpi.entityPrefix}_${ek}`
        const eColor = ENTITY_COLORS[ei % ENTITY_COLORS.length]
        const dash   = KPI_DASH[kpi.id]

        if (kpi.shape === 'bar') {
          nodes.push(
            <Bar key={dk} yAxisId={kpi.axis} dataKey={dk}
              name={`${ek} – ${kpi.label}`}
              fill={eColor} fillOpacity={0.6}
              radius={[2,2,0,0]} maxBarSize={16} />
          )
        } else {
          // Area-type gross → render entity as line to avoid fill clutter
          nodes.push(
            <Line key={dk} yAxisId={kpi.axis} type="monotone" dataKey={dk}
              name={`${ek} – ${kpi.label}`}
              stroke={eColor} strokeWidth={1.8}
              strokeDasharray={dash} dot={false} />
          )
        }
      }
    }
    return nodes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKpis, hasEntities, multi, multiKeys.join(','), visibleEntities.join(',')])

  const hasDollar = activeKpis.has('revenue') || activeKpis.has('profit')
  const hasPct    = activeKpis.has('margin')
  const hasCount  = activeKpis.has('loadCount')
  const hasRight  = hasPct || hasCount

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Trends</h1>
        <div className={styles.granToggle}>
          {(['day','week','month'] as TrendGranularity[]).map(g => (
            <button key={g} className={`${styles.granBtn} ${gran === g ? styles.granActive : ''}`}
              onClick={() => setGran(g)}>
              {g.charAt(0).toUpperCase() + g.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Toggle controls */}
      <div className={styles.controls}>
        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>Metrics</span>
          <div className={styles.pills}>
            {KPIS.map(kpi => (
              <button key={kpi.id}
                className={`${styles.pill} ${activeKpis.has(kpi.id) ? styles.pillOn : ''}`}
                style={activeKpis.has(kpi.id) ? { borderColor: KPI_COLOR[kpi.id], color: KPI_COLOR[kpi.id], background: `${KPI_COLOR[kpi.id]}1a` } : undefined}
                onClick={() => toggleKpi(kpi.id)}>
                <span className={styles.dot} style={{ background: KPI_COLOR[kpi.id] }} />
                {kpi.label}
              </button>
            ))}
          </div>
        </div>

        {multiKeys.length > 0 && (
          <div className={styles.controlGroup}>
            <span className={styles.controlLabel}>Overlay by</span>
            <div className={styles.pills}>
              {multiKeys.map((key, i) => {
                const color = ENTITY_COLORS[i % ENTITY_COLORS.length]
                return (
                  <button key={key}
                    className={`${styles.pill} ${activeEntities.has(key) ? styles.pillOn : ''}`}
                    style={activeEntities.has(key) ? { borderColor: color, color, background: `${color}1a` } : undefined}
                    onClick={() => toggleEntity(key)}>
                    <span className={styles.dot} style={{ background: color }} />
                    {key}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Chart */}
      <div className={styles.chartCard}>
        <ResponsiveContainer width="100%" height={480}>
          <ComposedChart data={data} margin={{ top: 8, right: hasRight ? 56 : 12, left: 0, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="period" tick={axisTick} tickLine={false}
              interval="preserveStartEnd" tickFormatter={fmt.dateTick} />

            <YAxis yAxisId="left" orientation="left" tick={axisTick} tickLine={false} axisLine={false}
              tickFormatter={(v: number) => `$${(v/1000).toFixed(0)}k`} width={52}
              hide={!hasDollar} />

            <YAxis yAxisId="right" orientation="right" tick={axisTick} tickLine={false} axisLine={false}
              tickFormatter={hasPct ? (v: number) => `${v.toFixed(0)}%` : (v: number) => String(Math.round(v))}
              width={44} hide={!hasRight} />

            {/* Load count uses its own hidden axis so scale stays independent of pct */}
            <YAxis yAxisId="count" orientation="right" hide />

            <Tooltip
              contentStyle={ttStyle} labelStyle={ttLabel} labelFormatter={fmt.date}
              formatter={(v: unknown, _n: unknown, props: { dataKey?: string | number }) =>
                fmtVal(v as number, keyFormat[String(props.dataKey ?? '')] ?? 'count')
              }
            />

            {series}
          </ComposedChart>
        </ResponsiveContainer>

        {/* Dash-pattern legend shown when entity overlays are active */}
        {hasEntities && (
          <div className={styles.dashLegend}>
            {KPIS.filter(k => activeKpis.has(k.id)).map(kpi => (
              <span key={kpi.id} className={styles.dashItem}>
                <svg width="26" height="10" style={{ flexShrink: 0 }}>
                  <line x1="1" y1="5" x2="25" y2="5"
                    stroke={KPI_COLOR[kpi.id]} strokeWidth="2"
                    strokeDasharray={KPI_DASH[kpi.id] ?? ''} />
                </svg>
                {kpi.label}
              </span>
            ))}
            <span className={styles.dashNote}>Same color = same entity · Line pattern = metric</span>
          </div>
        )}
      </div>
    </div>
  )
}
