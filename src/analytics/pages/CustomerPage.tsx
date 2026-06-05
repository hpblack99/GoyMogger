import { useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ComposedChart, Area, Line, ReferenceLine, ReferenceArea, Cell,
} from 'recharts'
import { useAnalytics } from '../AnalyticsApp'
import { calcEntitySummaries, calcPeriodKPIs, safeDiv, fmt } from '../lib/calculations'
import type { TrendGranularity } from '../lib/calculations'
import { useMultiTrend, ENTITY_COLORS, GROSS_COLORS } from '../lib/useMultiSeries'
import FilterBar from '../components/FilterBar'
import DataTable from '../components/DataTable'
import type { EntitySummary } from '../lib/types'
import type { Column } from '../components/DataTable'
import CustomerSettingsModal from '../components/CustomerSettingsModal'
import styles from './CustomerPage.module.css'

// ── KPI definitions ───────────────────────────────────────────────────────────

type KpiId = 'revenue' | 'profit' | 'margin' | 'loadCount'
interface KpiDef {
  id: KpiId; label: string; axis: 'left'|'right'|'count'
  grossKey: string; entityPrefix: string; format: 'dollar'|'pct'|'count'
  shape: 'area'|'line'|'bar'
}

const KPIS: KpiDef[] = [
  { id: 'revenue',   label: 'Revenue',  axis: 'left',  grossKey: 'revenue',   entityPrefix: 'rev',    format: 'dollar', shape: 'area' },
  { id: 'profit',    label: 'Profit',   axis: 'left',  grossKey: 'profit',    entityPrefix: 'profit', format: 'dollar', shape: 'area' },
  { id: 'margin',    label: 'Margin %', axis: 'right', grossKey: 'margin',    entityPrefix: 'margin', format: 'pct',    shape: 'line' },
  { id: 'loadCount', label: 'Loads',    axis: 'count', grossKey: 'loadCount', entityPrefix: 'loads',  format: 'count',  shape: 'bar'  },
]

const KPI_COLOR: Record<KpiId, string> = {
  revenue: GROSS_COLORS.revenue, profit: GROSS_COLORS.profit,
  margin:  GROSS_COLORS.margin,  loadCount: GROSS_COLORS.loads,
}

const KPI_DASH: Record<KpiId, string | undefined> = {
  revenue: undefined, profit: '6 3', margin: '2 4', loadCount: undefined,
}

import type { OptionGroup } from '../components/MultiSelect'

const PAGE_SIZE = 15

// Merge individual customer summaries into umbrella groups where applicable
function consolidateSummaries(summaries: EntitySummary[], groups: OptionGroup[]): EntitySummary[] {
  const grouped = new Map<string, EntitySummary>()   // groupLabel → merged
  const standalone: EntitySummary[] = []

  for (const s of summaries) {
    const g = groups.find(g => g.match(s.name))
    if (g) {
      const existing = grouped.get(g.label)
      if (!existing) {
        grouped.set(g.label, { ...s, name: g.label })
      } else {
        const revenue   = existing.revenue   + s.revenue
        const profit    = existing.profit    + s.profit
        const cost      = existing.cost      + s.cost
        const loadCount = existing.loadCount + s.loadCount
        grouped.set(g.label, {
          name: g.label,
          revenue, profit, cost, loadCount,
          margin:         safeDiv(profit, revenue) * 100,
          revenuePerLoad: safeDiv(revenue, loadCount),
          profitPerLoad:  safeDiv(profit,  loadCount),
        })
      }
    } else {
      standalone.push(s)
    }
  }

  return [...standalone, ...grouped.values()].sort((a, b) => b.revenue - a.revenue)
}
const TOP_N_OPTIONS = [5, 10, 15, 20] as const

function makeCols(onSettings: (name: string) => void): Column<EntitySummary>[] {
  return [
    { key: 'name',           header: 'Customer' },
    { key: 'loadCount',      header: 'Loads',       align: 'right', render: r => fmt.num(r.loadCount) },
    { key: 'revenue',        header: 'Revenue',     align: 'right', render: r => fmt.dollar(r.revenue) },
    { key: 'profit',         header: 'Profit',      align: 'right', render: r => fmt.dollar(r.profit) },
    { key: 'margin',         header: 'Margin',      align: 'right', render: r => fmt.pct(r.margin) },
    { key: 'revenuePerLoad', header: 'Rev/Load',    align: 'right', render: r => fmt.dollar(r.revenuePerLoad) },
    { key: 'profitPerLoad',  header: 'Profit/Load', align: 'right', render: r => fmt.dollar(r.profitPerLoad) },
    {
      key: '_settings', header: '',
      render: r => (
        <button className={styles.settingsBtn} onClick={e => { e.stopPropagation(); onSettings(r.name) }} title="Customer settings">
          ⚙
        </button>
      ),
    },
  ]
}

// ── Recharts helpers ──────────────────────────────────────────────────────────

const axisTick = { fontSize: 10, fill: '#6e7681' }
const gridProps = { strokeDasharray: '3 3' as const, stroke: '#21262d' }
const ttStyle   = { background: '#161b22', border: '1px solid #30363d', borderRadius: 8, fontSize: 12, color: '#c9d1d9' }
const ttLabel   = { color: '#c9d1d9', fontWeight: 600 }
const ttItem    = { color: '#c9d1d9' }

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

function TrendPct({ pct }: { pct: number }) {
  if (!isFinite(pct)) return <span className={styles.trendFlat}>—</span>
  if (pct === 0)      return <span className={styles.trendFlat}>0.0%</span>
  return (
    <span className={pct > 0 ? styles.trendUp : styles.trendDown}>
      {pct > 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}% vs prior period
    </span>
  )
}

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

// ── Main component ────────────────────────────────────────────────────────────

export default function CustomerPage() {
  const { filteredLoads, allLoads, filters, setFilters, customers, salesReps, branches, customerGroups } = useAnalytics()

  // Table pagination
  const [page, setPage] = useState(0)
  const [settingsCustomer, setSettingsCustomer] = useState<string | null>(null)

  // Expand state
  const [expanded, setExpanded]     = useState(false)
  const [expandMode, setExpandMode] = useState<'trend'|'gross'>('trend')

  // Gross mode controls
  const [topN, setTopN]           = useState<5|10|15|20>(15)
  const [grossMetric, setGrossMetric] = useState<KpiId>('revenue')

  // Trend chart state (shared between minimized hint + expanded)
  const [gran, setGran]           = useState<TrendGranularity>('week')
  const [activeKpis, setActiveKpis] = useState<Set<KpiId>>(new Set(['revenue','profit','margin','loadCount']))
  const [activeEntities, setActiveEntities] = useState<Set<string>>(new Set())
  const [deltaMode, setDeltaMode] = useState(false)
  const [pointA, setPointA]       = useState<string|null>(null)
  const [pointB, setPointB]       = useState<string|null>(null)

  // ── Trend data (same as TrendsPage) ──────────────────────────────────────

  const { multi, chartData: weekData }  = useMultiTrend(filteredLoads, filters, 'week')
  const { chartData: dayData }          = useMultiTrend(filteredLoads, filters, 'day')
  const { chartData: monthData }        = useMultiTrend(filteredLoads, filters, 'month')

  const trendData  = gran === 'day' ? dayData : gran === 'month' ? monthData : weekData
  const multiKeys  = multi?.keys ?? []

  const toggleKpi    = (id: KpiId)   => setActiveKpis(p    => { const n = new Set(p); n.has(id)  ? n.delete(id)  : n.add(id);  return n })
  const toggleEntity = (key: string) => setActiveEntities(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n })

  const visibleEntities = multiKeys.filter(k => activeEntities.has(k))
  const hasEntities     = visibleEntities.length > 0

  const toggleDeltaMode = () => { setDeltaMode(d => !d); setPointA(null); setPointB(null) }
  const handleChartClick = (e: { activeLabel?: string }) => {
    if (!deltaMode || !e?.activeLabel) return
    if (!pointA)                             setPointA(e.activeLabel)
    else if (!pointB && e.activeLabel !== pointA) setPointB(e.activeLabel)
    else { setPointA(e.activeLabel); setPointB(null) }
  }

  const [pA, pB] = useMemo(() => {
    if (!pointA || !pointB) return [pointA, pointB]
    return pointA <= pointB ? [pointA, pointB] : [pointB, pointA]
  }, [pointA, pointB])

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

  const deltaRows = useMemo(() => {
    if (!pA || !pB) return null
    const rowA = trendData.find(d => (d as Record<string,unknown>).period === pA) as Record<string,number>|undefined
    const rowB = trendData.find(d => (d as Record<string,unknown>).period === pB) as Record<string,number>|undefined
    if (!rowA || !rowB) return null
    return KPIS.filter(k => activeKpis.has(k.id)).map(kpi => {
      const gk = multi ? `gross_${kpi.grossKey}` : kpi.grossKey
      const vA = rowA[gk] ?? 0, vB = rowB[gk] ?? 0
      const nominal = vB - vA
      const pct = vA !== 0 ? (nominal / Math.abs(vA)) * 100 : 0
      return { kpi, nominal, pct }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pA, pB, trendData, activeKpis, multi])

  const hasDollar = activeKpis.has('revenue') || activeKpis.has('profit')
  const hasPct    = activeKpis.has('margin')
  const hasCount  = activeKpis.has('loadCount')
  const hasRight  = hasPct || hasCount

  const tickFmt  = gran === 'week' ? fmt.weekRangeTick  : fmt.dateTick
  const labelFmt = gran === 'week' ? fmt.weekRangeLabel : fmt.date

  const series = useMemo<React.ReactNode[]>(() => {
    const nodes: React.ReactNode[] = []
    for (const kpi of KPIS) {
      if (!activeKpis.has(kpi.id)) continue
      const gk    = multi ? `gross_${kpi.grossKey}` : kpi.grossKey
      const color = KPI_COLOR[kpi.id]
      const fade  = hasEntities
      if (kpi.shape === 'area') {
        const gid = `cp-grad-${kpi.id}`
        nodes.push(
          <defs key={`defs-${kpi.id}`}>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={color} stopOpacity={fade ? 0.06 : 0.28} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
        )
        nodes.push(<Area key={gk} yAxisId={kpi.axis} type="monotone" dataKey={gk}
          name={multi ? `${kpi.label} (Total)` : kpi.label}
          stroke={color} strokeWidth={fade ? 1.5 : 2.5} strokeDasharray={fade ? '4 3' : undefined}
          fill={`url(#${gid})`} dot={false} />)
      } else if (kpi.shape === 'bar') {
        nodes.push(<Bar key={gk} yAxisId={kpi.axis} dataKey={gk}
          name={multi ? `${kpi.label} (Total)` : kpi.label}
          fill={color} fillOpacity={fade ? 0.22 : 0.65} radius={[2,2,0,0]} maxBarSize={fade ? 18 : 32} />)
      } else {
        nodes.push(<Line key={gk} yAxisId={kpi.axis} type="monotone" dataKey={gk}
          name={multi ? `${kpi.label} (Total)` : kpi.label}
          stroke={color} strokeWidth={fade ? 1.5 : 2.5} strokeDasharray={fade ? '4 3' : undefined} dot={false} />)
      }
      for (let ei = 0; ei < multiKeys.length; ei++) {
        const ek = multiKeys[ei]
        if (!visibleEntities.includes(ek)) continue
        const dk = `${kpi.entityPrefix}_${ek}`
        const eColor = ENTITY_COLORS[ei % ENTITY_COLORS.length]
        if (kpi.shape === 'bar') {
          nodes.push(<Bar key={dk} yAxisId={kpi.axis} dataKey={dk} name={`${ek} – ${kpi.label}`}
            fill={eColor} fillOpacity={0.6} radius={[2,2,0,0]} maxBarSize={16} />)
        } else {
          nodes.push(<Line key={dk} yAxisId={kpi.axis} type="monotone" dataKey={dk}
            name={`${ek} – ${kpi.label}`} stroke={eColor} strokeWidth={1.8}
            strokeDasharray={KPI_DASH[kpi.id]} dot={false} />)
        }
      }
    }
    return nodes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKpis, hasEntities, multi, multiKeys.join(','), visibleEntities.join(',')])

  // ── Customer summary data ─────────────────────────────────────────────────

  const summaries = useMemo(
    () => consolidateSummaries(calcEntitySummaries(filteredLoads, 'customer_name'), customerGroups),
    [filteredLoads, customerGroups]
  )

  const activeCarriers = useMemo(() =>
    new Set(filteredLoads.map(l => l.current_carrier_name).filter(Boolean)).size,
    [filteredLoads]
  )

  const entityFilteredLoads = useMemo(() => {
    const customerSet = filters.customers.length > 0
      ? new Set(filters.customers.map(c => c.trim().toLowerCase())) : null
    const repSet = filters.salesReps.length > 0
      ? new Set(filters.salesReps.map(r => r.trim().toLowerCase())) : null
    const branchSet = filters.branches.length > 0
      ? new Set(filters.branches.map(b => b.trim().toLowerCase())) : null
    return allLoads.filter(l => {
      if (customerSet && !customerSet.has((l.customer_name ?? '').trim().toLowerCase())) return false
      if (repSet      && !repSet.has((l.sales_rep ?? '').trim().toLowerCase()))          return false
      if (branchSet   && !branchSet.has((l.branch_name ?? '').trim().toLowerCase()))     return false
      return true
    })
  }, [allLoads, filters])

  const period = useMemo(() =>
    calcPeriodKPIs(entityFilteredLoads, filters.dateFrom, filters.dateTo),
    [entityFilteredLoads, filters.dateFrom, filters.dateTo]
  )

  // Pagination
  const totalPages = Math.ceil(summaries.length / PAGE_SIZE)
  const pageRows   = summaries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  // Grand total footer
  const totalLoads  = summaries.reduce((s, x) => s + x.loadCount, 0)
  const totalRev    = summaries.reduce((s, x) => s + x.revenue,   0)
  const totalProfit = summaries.reduce((s, x) => s + x.profit,    0)
  const totalCost   = summaries.reduce((s, x) => s + x.cost,      0)
  const totalMargin = totalRev > 0 ? (totalProfit / totalRev) * 100 : 0
  const footerCells = [
    'TOTAL',
    fmt.num(totalLoads),
    fmt.dollar(totalRev),
    fmt.dollar(totalProfit),
    fmt.pct(totalMargin),
    fmt.dollar(totalRev    / Math.max(totalLoads, 1)),
    fmt.dollar(totalProfit / Math.max(totalLoads, 1)),
  ]

  // Gross bar chart
  const grossChartData = summaries.slice(0, topN).map((s, i) => ({
    name: s.name,
    value: grossMetric === 'revenue'   ? s.revenue
         : grossMetric === 'profit'    ? s.profit
         : grossMetric === 'margin'    ? s.margin
         : s.loadCount,
    color: ENTITY_COLORS[i % ENTITY_COLORS.length],
  }))

  // ── Sub-components ────────────────────────────────────────────────────────

  function DeltaBox() {
    if (!pA || !pB || !deltaRows) return null
    return (
      <div className={styles.deltaBox}>
        <div className={styles.deltaHeader}>
          <span style={{ color: '#60a5fa' }}>A</span> {tickFmt(pA)}
          <span className={styles.deltaArrow}>→</span>
          <span style={{ color: '#f472b6' }}>B</span> {tickFmt(pB)}
        </div>
        <div className={styles.deltaRows}>
          {deltaRows.map(({ kpi, nominal, pct }) => (
            <div key={kpi.id} className={styles.deltaRow}>
              <span className={styles.deltaKpiDot} style={{ background: KPI_COLOR[kpi.id] }} />
              <span className={styles.deltaKpiLabel}>{kpi.label}</span>
              <span className={`${styles.deltaChange} ${nominal >= 0 ? styles.deltaPos : styles.deltaNeg}`}>
                {fmtDelta(nominal, kpi.format)}
              </span>
              <span className={`${styles.deltaPct} ${pct >= 0 ? styles.deltaPos : styles.deltaNeg}`}>
                {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  function TrendControls() {
    return (
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
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>Customer Performance</h1>
        <button className={styles.expandBtn} onClick={() => setExpanded(true)}>⛶ Open Analysis</button>
      </div>

      {/* ── Dashboard ──────────────────────────────────────────────────────── */}
      <div className={styles.dashboardSection}>
        <div className={styles.dashboardLabel}>Dashboard</div>
        <div className={styles.kpiGrid}>
          {([
            { label: 'Customers',       value: fmt.num(summaries.length),          pct: null },
            { label: 'Active Carriers', value: fmt.num(activeCarriers),            pct: null },
            { label: 'Total Loads',     value: fmt.num(totalLoads),                pct: period.changes.loadCount },
            { label: 'Total Revenue',   value: fmt.dollar(totalRev),               pct: period.changes.revenue },
            { label: 'Total Expense',   value: fmt.dollar(totalCost),              pct: null },
            { label: 'Total GP',        value: fmt.dollar(totalProfit),            pct: period.changes.profit },
            { label: 'Avg Margin',      value: fmt.pct(totalMargin),               pct: period.changes.margin },
            { label: 'Rev / Load',      value: fmt.dollar(totalRev    / Math.max(totalLoads, 1)), pct: null },
            { label: 'GP / Load',       value: fmt.dollar(totalProfit / Math.max(totalLoads, 1)), pct: null },
          ] as { label: string; value: string; pct: number | null }[]).map(card => (
            <div key={card.label} className={styles.kpiCard}>
              <div className={styles.kpiLabel}>{card.label}</div>
              <div className={styles.kpiValue}>{card.value}</div>
              {card.pct !== null ? <TrendPct pct={card.pct} /> : <div className={styles.kpiSub}>&nbsp;</div>}
            </div>
          ))}
        </div>
      </div>

      {/* ── Data table with pagination + grand total ──────────────────────── */}
      <DataTable
        columns={makeCols(setSettingsCustomer)} rows={pageRows} rowKey={r => r.name}
        emptyMessage="No customer data" footerCells={footerCells}
      />
      {settingsCustomer && (
        <CustomerSettingsModal customerName={settingsCustomer} onClose={() => setSettingsCustomer(null)} />
      )}
      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button className={styles.pageBtn} disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</button>
          <span className={styles.pageInfo}>Page {page + 1} of {totalPages} ({summaries.length} customers)</span>
          <button className={styles.pageBtn} disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next →</button>
        </div>
      )}

      {/* ── Expanded analysis modal ────────────────────────────────────────── */}
      {expanded && (
        <div className={styles.overlay} onClick={() => setExpanded(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className={styles.modalHeader}>
              <span className={styles.modalTitle}>Customer Analysis</span>
              <div className={styles.modalControls}>

                <div className={styles.modeToggle}>
                  <button className={`${styles.modeBtn} ${expandMode === 'trend' ? styles.modeBtnOn : ''}`}
                    onClick={() => setExpandMode('trend')}>Trend</button>
                  <button className={`${styles.modeBtn} ${expandMode === 'gross' ? styles.modeBtnOn : ''}`}
                    onClick={() => setExpandMode('gross')}>Gross</button>
                </div>

                {expandMode === 'trend' && (
                  <>
                    <GranToggle gran={gran} onChange={setGran} />
                    <button className={`${styles.deltaBtn} ${deltaMode ? styles.deltaBtnOn : ''}`}
                      onClick={toggleDeltaMode}>Δ Compare</button>
                    {deltaMode && !pA && <span className={styles.deltaHintTop}>Click A</span>}
                    {deltaMode && pA && !pB && <span className={styles.deltaHintTop}>Click B</span>}
                  </>
                )}

                {expandMode === 'gross' && (
                  <>
                    <div className={styles.granToggle}>
                      {TOP_N_OPTIONS.map(n => (
                        <button key={n}
                          className={`${styles.granBtn} ${topN === n ? styles.granActive : ''}`}
                          onClick={() => setTopN(n)}>Top {n}</button>
                      ))}
                    </div>
                    <div className={styles.granToggle}>
                      {KPIS.map(k => (
                        <button key={k.id}
                          className={`${styles.granBtn} ${grossMetric === k.id ? styles.granActive : ''}`}
                          onClick={() => setGrossMetric(k.id)}>{k.label}</button>
                      ))}
                    </div>
                  </>
                )}

                <button className={styles.closeBtn} onClick={() => setExpanded(false)}>✕</button>
              </div>
            </div>

            {/* FilterBar */}
            <div className={styles.modalFilters}>
              <FilterBar
                filters={filters} onChange={setFilters}
                customers={customers} salesReps={salesReps}
                branches={branches} customerGroups={customerGroups}
              />
            </div>

            {/* Trend controls */}
            {expandMode === 'trend' && <TrendControls />}

            {/* Chart area */}
            <div className={styles.chartWithDelta}>
              {expandMode === 'trend' ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={trendData}
                    margin={{ top: 8, right: hasRight ? 56 : 12, left: 0, bottom: 0 }}
                    onClick={handleChartClick}
                    style={deltaMode ? { cursor: 'crosshair' } : undefined}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="period" tick={axisTick} tickLine={false}
                      interval="preserveStartEnd" tickFormatter={tickFmt} />
                    <YAxis yAxisId="left" orientation="left" tick={axisTick} tickLine={false} axisLine={false}
                      tickFormatter={(v: number) => `$${(v/1000).toFixed(0)}k`} width={52} hide={!hasDollar} />
                    <YAxis yAxisId="right" orientation="right" tick={axisTick} tickLine={false} axisLine={false}
                      tickFormatter={hasPct ? (v: number) => `${v.toFixed(0)}%` : (v: number) => String(Math.round(v))}
                      width={44} hide={!hasRight} />
                    <YAxis yAxisId="count" orientation="right" hide />
                    {!deltaMode && (
                      <Tooltip contentStyle={ttStyle} labelStyle={ttLabel} itemStyle={ttItem} labelFormatter={labelFmt}
                        formatter={(v: unknown, _n: unknown, props: { dataKey?: string|number }) =>
                          fmtVal(v as number, keyFormat[String(props.dataKey ?? '')] ?? 'count')} />
                    )}
                    {pA && pB && <ReferenceArea yAxisId="left" x1={pA} x2={pB} fill="#ffffff" fillOpacity={0.05} strokeOpacity={0} />}
                    {pA && <ReferenceLine yAxisId="left" x={pA} stroke="#60a5fa" strokeWidth={2} strokeDasharray="4 2"
                      label={{ value: 'A', fill: '#60a5fa', fontSize: 11, fontWeight: 700 }} />}
                    {pB && <ReferenceLine yAxisId="left" x={pB} stroke="#f472b6" strokeWidth={2} strokeDasharray="4 2"
                      label={{ value: 'B', fill: '#f472b6', fontSize: 11, fontWeight: 700 }} />}
                    {series}
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={grossChartData}
                    margin={{ top: 8, right: 16, left: 8, bottom: 100 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="name"
                      tick={{ fontSize: 10, fill: '#c9d1d9', angle: -40, textAnchor: 'end' } as object}
                      tickLine={false} interval={0} height={110} />
                    <YAxis tick={axisTick} tickLine={false} axisLine={false}
                      tickFormatter={(v: number) =>
                        grossMetric === 'margin'    ? `${v.toFixed(0)}%`
                        : grossMetric === 'loadCount' ? String(Math.round(v))
                        : `$${(v/1000).toFixed(0)}k`}
                      width={52} />
                    <Tooltip contentStyle={ttStyle} labelStyle={ttLabel} itemStyle={ttItem}
                      formatter={(v: number) => [
                        grossMetric === 'margin'    ? `${v.toFixed(1)}%`
                        : grossMetric === 'loadCount' ? fmt.num(v)
                        : fmt.dollar(v),
                        grossMetric === 'loadCount' ? 'Loads' : grossMetric.charAt(0).toUpperCase() + grossMetric.slice(1),
                      ]} />
                    <Bar dataKey="value" radius={[4,4,0,0]} maxBarSize={60}>
                      {grossChartData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} fillOpacity={0.88} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
              <DeltaBox />
            </div>

          </div>
        </div>
      )}
    </div>
  )
}
