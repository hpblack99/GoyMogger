import type { Load, KPIs, EntitySummary, TrendPoint, PeriodKPIs } from './types'

export const fmt = {
  dollar: (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }),
  dollarFull: (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }),
  pct: (n: number) => `${n.toFixed(1)}%`,
  num: (n: number) => n.toLocaleString('en-US'),
  change: (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`,
  /** Format an ISO date string or YYYY-MM partial as "Apr 7, 2026" */
  date: (iso: string): string => {
    if (!iso) return iso
    // YYYY-MM (month period key)
    if (/^\d{4}-\d{2}$/.test(iso)) {
      const d = new Date(iso + '-01T00:00:00')
      return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    }
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  },
  /** Shorter chart tick version — "Apr 7" (drops year to save space) */
  dateTick: (iso: string): string => {
    if (!iso) return iso
    if (/^\d{4}-\d{2}$/.test(iso)) {
      const d = new Date(iso + '-01T00:00:00')
      return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    }
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  },
}

export function safeDiv(a: number, b: number, fallback = 0): number {
  return b === 0 ? fallback : a / b
}

export function pctChange(current: number, prior: number): number {
  if (prior === 0) return current > 0 ? 100 : 0
  return ((current - prior) / Math.abs(prior)) * 100
}

export function calcKPIs(loads: Load[]): KPIs {
  const n = loads.length
  const revenue = loads.reduce((s, l) => s + (l.load_revenue ?? 0), 0)
  const cost = loads.reduce((s, l) => s + (l.load_carrier_expense ?? 0) + (l.load_other_expense ?? 0), 0)
  const profit = loads.reduce((s, l) => s + (l.load_profit ?? 0), 0)
  const customers = new Set(loads.map(l => l.customer_name).filter(Boolean))
  const reps = new Set(loads.map(l => l.sales_rep).filter(Boolean))
  return {
    revenue,
    cost,
    profit,
    margin: safeDiv(profit, revenue) * 100,
    loadCount: n,
    revenuePerLoad: safeDiv(revenue, n),
    profitPerLoad: safeDiv(profit, n),
    activeCustomers: customers.size,
    activeSalesReps: reps.size,
  }
}

export function calcPeriodKPIs(loads: Load[], dateFrom: string, dateTo: string): PeriodKPIs {
  const from = new Date(dateFrom)
  const to = new Date(dateTo)
  const spanMs = to.getTime() - from.getTime()
  const priorTo = new Date(from.getTime() - 1)
  const priorFrom = new Date(priorTo.getTime() - spanMs)

  const current = loads.filter(l => {
    const d = l.booked_date
    return d && d >= dateFrom && d <= dateTo
  })
  const prior = loads.filter(l => {
    const d = l.booked_date
    const pf = priorFrom.toISOString().slice(0, 10)
    const pt = priorTo.toISOString().slice(0, 10)
    return d && d >= pf && d <= pt
  })

  const c = calcKPIs(current)
  const p = calcKPIs(prior)
  const keys = Object.keys(c) as (keyof KPIs)[]
  const changes = {} as Record<keyof KPIs, number>
  keys.forEach(k => { changes[k] = pctChange(c[k], p[k]) })
  return { current: c, prior: p, changes }
}

export function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  return items.reduce((acc, item) => {
    const k = key(item) || 'Unknown'
    if (!acc[k]) acc[k] = []
    acc[k].push(item)
    return acc
  }, {} as Record<string, T[]>)
}

export function calcEntitySummaries(loads: Load[], key: keyof Load): EntitySummary[] {
  const groups = groupBy(loads, l => String(l[key] ?? 'Unknown'))
  return Object.entries(groups).map(([name, ls]) => {
    const kpis = calcKPIs(ls)
    return {
      name,
      revenue: kpis.revenue,
      cost: kpis.cost,
      profit: kpis.profit,
      margin: kpis.margin,
      loadCount: kpis.loadCount,
      revenuePerLoad: kpis.revenuePerLoad,
      profitPerLoad: kpis.profitPerLoad,
    }
  }).sort((a, b) => b.revenue - a.revenue)
}

export type TrendGranularity = 'day' | 'week' | 'month'

function getPeriodKey(dateStr: string, gran: TrendGranularity): string {
  const d = new Date(dateStr + 'T00:00:00')
  if (gran === 'day') return dateStr.slice(0, 10)
  if (gran === 'month') return dateStr.slice(0, 7)
  // week: ISO week start (Monday)
  const day = d.getDay() || 7
  const monday = new Date(d)
  monday.setDate(d.getDate() - day + 1)
  return monday.toISOString().slice(0, 10)
}

export function calcTrend(loads: Load[], gran: TrendGranularity): TrendPoint[] {
  const validLoads = loads.filter(l => l.booked_date)
  const groups = groupBy(validLoads, l => getPeriodKey(l.booked_date!, gran))
  return Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, ls]) => {
      const kpis = calcKPIs(ls)
      return {
        period,
        revenue: kpis.revenue,
        profit: kpis.profit,
        cost: kpis.cost,
        margin: kpis.margin,
        loadCount: kpis.loadCount,
        revenuePerLoad: kpis.revenuePerLoad,
        profitPerLoad: kpis.profitPerLoad,
      }
    })
}

export function calcConcentration(summaries: EntitySummary[], totalRevenue: number) {
  const sorted = [...summaries].sort((a, b) => b.revenue - a.revenue)
  const top5Rev = sorted.slice(0, 5).reduce((s, e) => s + e.revenue, 0)
  const top10Rev = sorted.slice(0, 10).reduce((s, e) => s + e.revenue, 0)
  return {
    top5Pct: safeDiv(top5Rev, totalRevenue) * 100,
    top10Pct: safeDiv(top10Rev, totalRevenue) * 100,
    top5Entities: sorted.slice(0, 5),
    top10Entities: sorted.slice(0, 10),
  }
}

export function identifyAccessorialFrequency(loads: Load[]): Record<string, number> {
  const counts: Record<string, number> = {}
  loads.forEach(l => {
    const raw = l.load_accessorials || l.quote_response_accessorials
    if (!raw || raw === '0' || raw.trim() === '') return
    raw.split(/[,;|]/).forEach(part => {
      const acc = part.trim()
      if (acc) counts[acc] = (counts[acc] ?? 0) + 1
    })
  })
  return counts
}

export function calcDiscountAnalysis(loads: Load[]) {
  const discountedLoads = loads.filter(l =>
    (l.quote_orig_rev ?? 0) > 0 && (l.load_revenue ?? 0) < (l.quote_orig_rev ?? 0)
  )
  const totalGross = loads.reduce((s, l) => s + (l.quote_orig_rev ?? 0), 0)
  const totalNet = loads.reduce((s, l) => s + (l.load_revenue ?? 0), 0)
  const totalDiscount = totalGross - totalNet
  return {
    totalGross,
    totalNet,
    totalDiscount,
    discountPct: safeDiv(totalDiscount, totalGross) * 100,
    discountedLoadCount: discountedLoads.length,
    avgDiscountPerLoad: safeDiv(totalDiscount, discountedLoads.length),
  }
}
