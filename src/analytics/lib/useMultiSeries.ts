import { useMemo } from 'react'
import { calcTrend } from './calculations'
import type { Load } from './types'
import type { TrendGranularity } from './calculations'
import type { AnalyticsFilters } from './types'

// Colors reserved exclusively for GROSS / combined series in charts
export const GROSS_COLORS = {
  revenue: '#22c55e',  // green
  profit:  '#a78bfa',  // violet
  margin:  '#06b6d4',  // cyan
  loads:   '#f59e0b',  // amber
  revPerLoad:    '#34d399', // emerald
  profitPerLoad: '#818cf8', // indigo
}

// Colors for individual entity overlay lines — never overlap with GROSS_COLORS
export const ENTITY_COLORS = [
  '#f472b6', // pink
  '#fb923c', // orange
  '#60a5fa', // blue
  '#e879f9', // fuchsia
  '#f87171', // coral
  '#2dd4bf', // teal
  '#a3e635', // lime
  '#fbbf24', // yellow
  '#c084fc', // purple-light
  '#38bdf8', // sky
]

// Keep SERIES_COLORS as alias so existing callers don't break
export const SERIES_COLORS = ENTITY_COLORS

/** Detect which filter dimension has multiple values selected, in priority order. */
export function getMultiDimension(filters: AnalyticsFilters) {
  if (filters.salesReps.length  > 1) return { dim: 'salesRep'  as const, keys: filters.salesReps,  field: 'sales_rep'    as keyof Load }
  if (filters.customers.length  > 1) return { dim: 'customer'  as const, keys: filters.customers,  field: 'customer_name' as keyof Load }
  if (filters.branches.length   > 1) return { dim: 'branch'    as const, keys: filters.branches,   field: 'branch_name'  as keyof Load }
  return null
}

/**
 * Returns merged trend data with gross + per-entity keys when multiple items
 * are selected, or plain trend data when not.
 *
 * In multi mode each row has:
 *   gross_revenue / gross_profit / gross_margin / gross_loadCount / gross_revenuePerLoad / gross_profitPerLoad
 *   rev_{key} / profit_{key} / margin_{key} / loads_{key} / revPerLoad_{key} / profitPerLoad_{key}
 */
export function useMultiTrend(
  filteredLoads: Load[],
  filters: AnalyticsFilters,
  gran: TrendGranularity,
) {
  const multi = getMultiDimension(filters)

  const grossTrend = useMemo(() => calcTrend(filteredLoads, gran), [filteredLoads, gran])

  const multiTrend = useMemo(() => {
    if (!multi) return null
    const { keys, field } = multi
    const byKey: Record<string, ReturnType<typeof calcTrend>> = {}
    for (const key of keys) {
      byKey[key] = calcTrend(filteredLoads.filter(l => (l[field] as string) === key), gran)
    }
    const allPeriods = [...new Set([
      ...grossTrend.map(t => t.period),
      ...Object.values(byKey).flatMap(arr => arr.map(t => t.period)),
    ])].sort()

    return allPeriods.map(period => {
      const base = grossTrend.find(t => t.period === period)
      const row: Record<string, unknown> = {
        period,
        gross_revenue:       base?.revenue       ?? 0,
        gross_profit:        base?.profit        ?? 0,
        gross_margin:        base?.margin        ?? 0,
        gross_loadCount:     base?.loadCount     ?? 0,
        gross_revenuePerLoad: base?.revenuePerLoad ?? 0,
        gross_profitPerLoad:  base?.profitPerLoad  ?? 0,
      }
      for (const key of keys) {
        const pt = byKey[key]?.find(t => t.period === period)
        row[`rev_${key}`]          = pt?.revenue       ?? 0
        row[`profit_${key}`]       = pt?.profit        ?? 0
        row[`margin_${key}`]       = pt?.margin        ?? 0
        row[`loads_${key}`]        = pt?.loadCount     ?? 0
        row[`revPerLoad_${key}`]   = pt?.revenuePerLoad ?? 0
        row[`profitPerLoad_${key}`] = pt?.profitPerLoad ?? 0
      }
      return row
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multi?.keys.join(','), filteredLoads, gran])

  return { multi, grossTrend, multiTrend, chartData: (multiTrend ?? grossTrend) as Record<string, unknown>[] }
}
