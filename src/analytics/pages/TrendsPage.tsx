import { useState, useMemo } from 'react'
import {
  ComposedChart, Area, Line, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ReferenceLine, ReferenceArea,
} from 'recharts'
import { useAnalytics } from '../AnalyticsApp'
import type { TrendGranularity } from '../lib/calculations'
import { fmt } from '../lib/calculations'
import { useMultiTrend, ENTITY_COLORS, GROSS_COLORS } from '../lib/useMultiSeries'
import FilterBar from '../components/FilterBar'
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

const KPI_DASH: Record<KpiId, string | undefined> = {
  revenue:   undefined,
  profit:    '6 3',
  margin:    '2 4',
  loadCount: undefined,
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

function fmtDelta(nominal: number, format: KpiDef['format']) {
  const sign = nominal >= 0 ? '+' : ''
  if (format === 'dollar') return `${sign}$${Math.abs(nominal).toLocaleString('en-US', { maximumFractionDigits: 0 })}${nominal < 0 ? ' ▼' : ' ▲'}`
  if (format === 'pct')    return `${sign}${nominal.toFixed(2)} pp${nominal < 0 ? ' ▼' : ' ▲'}`
  return `${sign}${Math.round(nominal)}${nominal < 0 ? ' ▼' : ' ▲'}`
}

// ── GranToggle helper ─────────────────────────────────────────────────────────

function GranToggle({ gran, onChange }: { gran: TrendGranularity; onChange: (g: TrendGranularity) => void }) {
  return (
    <div className={styles.granToggle}>
      {(['day','week','month'] as TrendGranularity[]).map(g => (
        <button key={g} className={`${styles.granBtn} ${gran === g ? styles.granActive : ''}`}
          onClick={() => onChange(g)}>
          {g.charAt(0).toUpperCase() + g.slice(1)}
        </button>
      ))}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TrendsPage() {
  const { filteredLoads, filters, setFilters, customers, salesReps, branches, customerGroups } = useAnalytics()
  const [gran, setGran]                     = useState<TrendGranularity>('week')
  const [activeKpis, setActiveKpis]         = useState<Set<KpiId>>(new Set(['revenue', 'profit', 'margin', 'loadCount']))
  const [activeEntities, setActiveEntities] = useState<Set<string>>(new Set())
  const [expanded, setExpanded]             = useState(false)
  const [deltaMode, setDeltaMode]           = useState(false)
  const [pointA, setPointA]                 = useState<string | null>(null)
  const [pointB, setPointB]                 = useState<string | null>(null)

  const { multi, chartData: weekData }  = useMultiTrend(filteredLoads, filters, 'week')
  const { chartData: dayData }          = useMultiTrend(filteredLoads, filters, 'day')
  const { chartData: monthData }        = useMultiTrend(filteredLoads, filters, 'month')

  const data      = gran === 'day' ? dayData : gran === 'month' ? monthData : weekData
  const multiKeys = multi?.keys ?? []

  const toggleKpi    = (id: KpiId)   => setActiveKpis(p    => { const n = new Set(p);    n.has(id)  ? n.delete(id)  : n.add(id);  return n })
  const toggleEntity = (key: string) => setActiveEntities(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n })

  const visibleEntities = multiKeys.filter(k => activeEntities.has(k))
  const hasEntities     = visibleEntities.length > 0

  const toggleDeltaMode = () => {
    setDeltaMode(d => !d)
    setPointA(null)
    setPointB(null)
  }

  const handleChartClick = (e: { activeLabel?: string }) => {
    if (!deltaMode || !e?.activeLabel) return
    if (!pointA) {
      setPointA(e.activeLabel)
    } else if (!pointB) {
      if (e.activeLabel !== pointA) setPointB(e.activeLabel)
    } else {
      setPointA(e.activeLabel)
      setPointB(null)
    }
  }

  // Ensure A is chronologically before B
  const [pA, pB] = useMemo(() => {
    if (!pointA || !pointB) return [pointA, pointB]
    return pointA <= pointB ? [pointA, pointB] : [pointB, pointA]
  }, [pointA, pointB])

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

  // Delta analysis computed from the two selected periods
  const deltaRows = useMemo(() => {
    if (!pA || !pB) return null
    const rowA = data.find(d => (d as Record<string,unknown>).period === pA) as Record<string,number> | undefined
    const rowB = data.find(d => (d as Record<string,unknown>).period === pB) as Record<string,number> | undefined
    if (!rowA || !rowB) return null

    const results: { kpi: KpiDef; vA: number; vB: number; nominal: number; pct: number }[] = []
    for (const kpi of KPIS) {
      if (!activeKpis.has(kpi.id)) continue
      const gk = multi ? `gross_${kpi.grossKey}` : kpi.grossKey
      const vA = rowA[gk] ?? 0
      const vB = rowB[gk] ?? 0
      const nominal = vB - vA
      const pct = vA !== 0 ? (nominal / Math.abs(vA)) * 100 : 0
      results.push({ kpi, vA, vB, nominal, pct })
    }
    return results
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pA, pB, data, activeKpis, multi])

  // Build chart series nodes
  const series = useMemo<React.ReactNode[]>(() => {
    const nodes: React.ReactNode[] = []

    for (const kpi of KPIS) {
      if (!activeKpis.has(kpi.id)) continue

      const gk    = multi ? `gross_${kpi.grossKey}` : kpi.grossKey
      const color = KPI_COLOR[kpi.id]
      const fade  = hasEntities

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

      for (let ei = 0; ei < multiKeys.length; ei++) {
        const ek = multiKeys[ei]
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

  function renderChart(height: number, interactive: boolean) {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={data}
          margin={{ top: 8, right: hasRight ? 56 : 12, left: 0, bottom: 0 }}
          onClick={interactive ? handleChartClick : undefined}
          style={interactive && deltaMode ? { cursor: 'crosshair' } : undefined}
        >
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="period" tick={axisTick} tickLine={false}
            interval="preserveStartEnd" tickFormatter={fmt.dateTick} />

          <YAxis yAxisId="left" orientation="left" tick={axisTick} tickLine={false} axisLine={false}
            tickFormatter={(v: number) => `$${(v/1000).toFixed(0)}k`} width={52}
            hide={!hasDollar} />

          <YAxis yAxisId="right" orientation="right" tick={axisTick} tickLine={false} axisLine={false}
            tickFormatter={hasPct ? (v: number) => `${v.toFixed(0)}%` : (v: number) => String(Math.round(v))}
            width={44} hide={!hasRight} />

          <YAxis yAxisId="count" orientation="right" hide />

          {!deltaMode && (
            <Tooltip
              contentStyle={ttStyle} labelStyle={ttLabel} labelFormatter={fmt.date}
              formatter={(v: unknown, _n: unknown, props: { dataKey?: string | number }) =>
                fmtVal(v as number, keyFormat[String(props.dataKey ?? '')] ?? 'count')
              }
            />
          )}

          {/* Delta range highlight */}
          {pA && pB && (
            <ReferenceArea yAxisId="left" x1={pA} x2={pB} fill="#ffffff" fillOpacity={0.05} strokeOpacity={0} />
          )}
          {pA && (
            <ReferenceLine yAxisId="left" x={pA} stroke="#60a5fa" strokeWidth={2}
              strokeDasharray="4 2" label={{ value: 'A', fill: '#60a5fa', fontSize: 11, fontWeight: 700 }} />
          )}
          {pB && (
            <ReferenceLine yAxisId="left" x={pB} stroke="#f472b6" strokeWidth={2}
              strokeDasharray="4 2" label={{ value: 'B', fill: '#f472b6', fontSize: 11, fontWeight: 700 }} />
          )}

          {series}
        </ComposedChart>
      </ResponsiveContainer>
    )
  }

  function DeltaBox() {
    if (!pA || !pB || !deltaRows) return null
    return (
      <div className={styles.deltaBox}>
        <div className={styles.deltaHeader}>
          <span className={styles.deltaPeriod}>
            <span style={{ color: '#60a5fa' }}>A</span> {fmt.dateTick(pA)}
          </span>
          <span className={styles.deltaArrow}>→</span>
          <span className={styles.deltaPeriod}>
            <span style={{ color: '#f472b6' }}>B</span> {fmt.dateTick(pB)}
          </span>
        </div>
        <div className={styles.deltaRows}>
          {deltaRows.map(({ kpi, nominal, pct }) => {
            const positive = nominal >= 0
            const cls = positive ? styles.deltaPos : styles.deltaNeg
            return (
              <div key={kpi.id} className={styles.deltaRow}>
                <span className={styles.deltaKpiDot} style={{ background: KPI_COLOR[kpi.id] }} />
                <span className={styles.deltaKpiLabel}>{kpi.label}</span>
                <span className={`${styles.deltaChange} ${cls}`}>
                  {fmtDelta(nominal, kpi.format)}
                </span>
                <span className={`${styles.deltaPct} ${cls}`}>
                  {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
                </span>
              </div>
            )
          })}
        </div>
        <div className={styles.deltaHint}>Click chart to reset</div>
      </div>
    )
  }

  const DashLegend = () => hasEntities ? (
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
  ) : null

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Trends</h1>
        <GranToggle gran={gran} onChange={setGran} />
      </div>

      {/* Metric + entity toggles */}
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

      {/* Chart card */}
      <div className={styles.chartCard}>
        <div className={styles.chartCardHeader}>
          <div className={styles.chartCardLeft}>
            <button
              className={`${styles.deltaBtn} ${deltaMode ? styles.deltaBtnOn : ''}`}
              onClick={toggleDeltaMode}
              title="Click two points on the chart to compare">
              Δ Compare
            </button>
            {deltaMode && !pA && <span className={styles.deltaHintTop}>Click point A on chart</span>}
            {deltaMode && pA && !pB && <span className={styles.deltaHintTop}>Click point B on chart</span>}
          </div>
          <button className={styles.expandBtn} onClick={() => setExpanded(true)} title="Full screen">⛶</button>
        </div>
        <div className={styles.chartWithDelta}>
          {renderChart(460, true)}
          <DeltaBox />
        </div>
        <DashLegend />
      </div>

      {/* ── Full screen modal ──────────────────────────────────────────────── */}
      {expanded && (
        <div className={styles.overlay} onClick={() => setExpanded(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            {/* Modal header */}
            <div className={styles.modalHeader}>
              <span className={styles.modalTitle}>Trends</span>
              <div className={styles.modalControls}>
                <GranToggle gran={gran} onChange={setGran} />
                <button
                  className={`${styles.deltaBtn} ${deltaMode ? styles.deltaBtnOn : ''}`}
                  onClick={toggleDeltaMode}
                  title="Click two points on the chart to compare">
                  Δ Compare
                </button>
                {deltaMode && !pA && (
                  <span className={styles.deltaHintTop}>Click point A on chart</span>
                )}
                {deltaMode && pA && !pB && (
                  <span className={styles.deltaHintTop}>Click point B on chart</span>
                )}
                <button className={styles.closeBtn} onClick={() => setExpanded(false)}>✕</button>
              </div>
            </div>

            {/* Filters */}
            <div className={styles.modalFilters}>
              <FilterBar
                filters={filters} onChange={setFilters}
                customers={customers} salesReps={salesReps}
                branches={branches} customerGroups={customerGroups}
              />
            </div>

            {/* Metric + entity toggles inside modal */}
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

            {/* Chart + delta box */}
            <div className={styles.chartWithDelta}>
              {renderChart(560, true)}
              <DeltaBox />
            </div>

            <DashLegend />
          </div>
        </div>
      )}
    </div>
  )
}
