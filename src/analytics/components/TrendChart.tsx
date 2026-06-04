import { useState, useCallback } from 'react'
import {
  AreaChart, Area, LineChart, Line, ComposedChart,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  Bar,
} from 'recharts'
import type { TrendGranularity } from '../lib/calculations'
import { fmt } from '../lib/calculations'
import styles from './TrendChart.module.css'

const axisTick = { fontSize: 10, fill: '#6e7681' }
const grid     = { strokeDasharray: '3 3' as const, stroke: '#21262d' }
const ttStyle  = { background: '#161b22', border: '1px solid #21262d', borderRadius: 8 }
const ttLabel  = { color: '#c9d1d9' }

function fmtTick(type: ValueType) {
  if (type === 'dollar')  return (v: number) => `$${(v / 1000).toFixed(0)}k`
  if (type === 'pct')     return (v: number) => `${v.toFixed(0)}%`
  if (type === 'dollar2') return (v: number) => `$${v.toFixed(0)}`
  return (v: number) => String(v)
}

function fmtTT(type: ValueType) {
  if (type === 'dollar')  return (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  if (type === 'pct')     return (v: number) => `${v.toFixed(1)}%`
  if (type === 'dollar2') return (v: number) => `$${v.toFixed(2)}`
  return (v: number) => String(v)
}

export type ValueType = 'dollar' | 'pct' | 'count' | 'dollar2'
export type ChartShape = 'area' | 'line' | 'bar'

export interface GrossSeries {
  dataKey: string
  name: string
  color: string
  shape: ChartShape
  /** If true, renders dashed when there are also entity overlays */
  dashed?: boolean
  rightAxis?: boolean   // for dual-axis (Trends page)
}

export interface EntityGroup {
  label: string
  color: string
  series: { dataKey: string; name: string; shape: ChartShape; rightAxis?: boolean }[]
}

interface Props {
  title: string
  weekData: Record<string, unknown>[]
  dayData:  Record<string, unknown>[]
  grossSeries: GrossSeries[]
  entityGroups?: EntityGroup[]   // per-entity toggleable overlays
  valueType: ValueType
  rightValueType?: ValueType     // for dual axis
  height?: number
  /** Optional external gran state (Trends page owns it globally) */
  gran?: TrendGranularity
  onGranChange?: (g: TrendGranularity) => void
  monthData?: Record<string, unknown>[]
}

export default function TrendChart({
  title, weekData, dayData, monthData,
  grossSeries, entityGroups = [],
  valueType, rightValueType,
  height = 200, gran, onGranChange,
}: Props) {
  const [visible, setVisible]     = useState<Set<string>>(new Set())
  const [expanded, setExpanded]   = useState(false)
  const [expGran, setExpGran]     = useState<TrendGranularity>('week')

  const toggleEntity = useCallback((label: string) => {
    setVisible(prev => { const n = new Set(prev); n.has(label) ? n.delete(label) : n.add(label); return n })
  }, [])

  const hasDual = grossSeries.some(s => s.rightAxis) ||
    entityGroups.some(g => g.series.some(s => s.rightAxis))

  const currentGran: TrendGranularity = gran ?? 'week'
  const activeData =
    currentGran === 'day'   ? dayData
    : currentGran === 'month' ? (monthData ?? weekData)
    : weekData

  const expandData =
    expGran === 'day'   ? dayData
    : expGran === 'month' ? (monthData ?? weekData)
    : weekData

  function renderSeries(
    showEntities: string[],
    isDashed: boolean,
  ) {
    const nodes: React.ReactNode[] = []

    for (const s of grossSeries) {
      const dKey = s.dataKey
      const color = s.color
      const axisId = s.rightAxis ? 'right' : 'left'
      const sw = isDashed ? 2 : 2

      if (s.shape === 'area') {
        const gradId = `grad-${dKey}`
        nodes.push(
          <defs key={`defs-${dKey}`}>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={color} stopOpacity={isDashed ? 0.15 : 0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
        )
        nodes.push(
          <Area key={dKey} yAxisId={axisId} type="monotone" dataKey={dKey} name={s.name}
            stroke={color} strokeWidth={sw} fill={`url(#${gradId})`}
            strokeDasharray={isDashed ? '5 3' : undefined} dot={false} />
        )
      } else if (s.shape === 'bar') {
        nodes.push(
          <Bar key={dKey} yAxisId={axisId} dataKey={dKey} name={s.name}
            fill={color} fillOpacity={isDashed ? 0.35 : 0.7} radius={[2,2,0,0]} maxBarSize={32} />
        )
      } else {
        nodes.push(
          <Line key={dKey} yAxisId={axisId} type="monotone" dataKey={dKey} name={s.name}
            stroke={color} strokeWidth={sw} strokeDasharray={isDashed ? '5 3' : undefined} dot={false} />
        )
      }
    }

    for (const g of entityGroups) {
      if (!showEntities.includes(g.label)) continue
      for (const s of g.series) {
        const axisId = s.rightAxis ? 'right' : 'left'
        if (s.shape === 'bar') {
          nodes.push(
            <Bar key={s.dataKey} yAxisId={axisId} dataKey={s.dataKey} name={`${g.label} – ${s.name}`}
              fill={g.color} fillOpacity={0.5} radius={[2,2,0,0]} maxBarSize={20} />
          )
        } else {
          nodes.push(
            <Line key={s.dataKey} yAxisId={axisId} type="monotone" dataKey={s.dataKey}
              name={`${g.label} – ${s.name}`}
              stroke={g.color} strokeWidth={1.5} dot={false} />
          )
        }
      }
    }

    return nodes
  }

  function ChartBody({ data, h, withLegend }: {
    data: Record<string, unknown>[]; h: number; withLegend?: boolean
  }) {
    const showEntities = entityGroups.filter(g => visible.has(g.label)).map(g => g.label)
    const isDashed     = showEntities.length > 0
    const series       = renderSeries(showEntities, isDashed)
    const tt           = fmtTick(valueType)
    const ttFn         = fmtTT(valueType)
    const ttR          = rightValueType ? fmtTT(rightValueType) : undefined
    const legStyle     = { fontSize: 10, color: '#6e7681' }

    const axes = (
      <>
        <CartesianGrid {...grid} />
        <XAxis dataKey="period" tick={axisTick} tickLine={false} interval="preserveStartEnd"
          tickFormatter={fmt.dateTick} />
        <YAxis yAxisId="left" tick={axisTick} tickLine={false} axisLine={false}
          tickFormatter={tt} width={48} />
        {hasDual && (
          <YAxis yAxisId="right" orientation="right" tick={axisTick} tickLine={false} axisLine={false}
            tickFormatter={rightValueType ? fmtTick(rightValueType) : (v: number) => `${v.toFixed(0)}%`} width={40} />
        )}
        <Tooltip contentStyle={ttStyle} labelStyle={ttLabel} labelFormatter={fmt.date}
          formatter={(v: number, name: string) => {
            const isRight = grossSeries.find(s => s.name === name)?.rightAxis ||
              entityGroups.some(g => g.series.find(s => `${g.label} – ${s.name}` === name)?.rightAxis)
            return isRight && ttR ? ttR(v) : ttFn(v)
          }} />
        {(withLegend || isDashed) && <Legend wrapperStyle={legStyle} />}
      </>
    )

    // Pick container type based on what's in series
    const hasBar  = grossSeries.some(s => s.shape === 'bar') || entityGroups.some(g => g.series.some(s => s.shape === 'bar'))
    const hasArea = grossSeries.some(s => s.shape === 'area')
    const hasEntityLines = showEntities.length > 0 && entityGroups.some(g =>
      showEntities.includes(g.label) && g.series.some(s => s.shape === 'line')
    )
    const ChartEl = (hasDual || hasBar || (hasArea && hasEntityLines)) ? ComposedChart : hasArea ? AreaChart : LineChart

    return (
      <ResponsiveContainer width="100%" height={h}>
        <ChartEl data={data} margin={{ top: 4, right: hasDual ? 16 : 8, left: 0, bottom: 0 }}>
          {axes}
          {series}
        </ChartEl>
      </ResponsiveContainer>
    )
  }

  return (
    <>
      <div className={styles.card}>
        <div className={styles.header}>
          <span className={styles.title}>{title}</span>
          <div className={styles.controls}>
            {entityGroups.length > 0 && (
              <div className={styles.entityToggles}>
                {entityGroups.map(g => (
                  <button
                    key={g.label}
                    className={`${styles.entityBtn} ${visible.has(g.label) ? styles.entityBtnOn : ''}`}
                    style={visible.has(g.label) ? { borderColor: g.color, color: g.color, background: `${g.color}18` } : undefined}
                    onClick={() => toggleEntity(g.label)}
                    title={g.label}
                  >
                    <span className={styles.entityDot} style={{ background: g.color }} />
                    <span className={styles.entityName}>{g.label}</span>
                  </button>
                ))}
              </div>
            )}
            {onGranChange && gran && (
              <div className={styles.granToggle}>
                {(['day','week','month'] as TrendGranularity[]).map(g => (
                  <button key={g} className={`${styles.granBtn} ${gran === g ? styles.granActive : ''}`}
                    onClick={() => onGranChange(g)}>{g[0].toUpperCase()}</button>
                ))}
              </div>
            )}
            <button className={styles.expandBtn} onClick={() => setExpanded(true)} title="Expand">⛶</button>
          </div>
        </div>

        <ChartBody data={activeData} h={height} />
      </div>

      {expanded && (
        <div className={styles.overlay} onClick={() => setExpanded(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span className={styles.modalTitle}>{title}</span>
              <div className={styles.modalControls}>
                {entityGroups.length > 0 && (
                  <div className={styles.entityToggles}>
                    {entityGroups.map(g => (
                      <button
                        key={g.label}
                        className={`${styles.entityBtn} ${visible.has(g.label) ? styles.entityBtnOn : ''}`}
                        style={visible.has(g.label) ? { borderColor: g.color, color: g.color, background: `${g.color}18` } : undefined}
                        onClick={() => toggleEntity(g.label)}
                      >
                        <span className={styles.entityDot} style={{ background: g.color }} />
                        <span className={styles.entityName}>{g.label}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className={styles.granToggle}>
                  {(['day','week','month'] as TrendGranularity[]).map(g => (
                    <button key={g} className={`${styles.granBtn} ${expGran === g ? styles.granActive : ''}`}
                      onClick={() => setExpGran(g)}>
                      {g.charAt(0).toUpperCase() + g.slice(1)}
                    </button>
                  ))}
                </div>
                <button className={styles.closeBtn} onClick={() => setExpanded(false)}>✕</button>
              </div>
            </div>
            <ChartBody data={expandData} h={420} withLegend />
          </div>
        </div>
      )}
    </>
  )
}
