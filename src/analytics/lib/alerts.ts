import type { Load, Alert, KPIs, PeriodKPIs } from './types'
import { pctChange, safeDiv } from './calculations'

let _id = 0
const id = () => String(++_id)

export function generateAlerts(
  loads: Load[],
  periodKPIs: PeriodKPIs,
  customerRevenues: { name: string; revenue: number }[],
): Alert[] {
  const alerts: Alert[] = []
  const c = periodKPIs.current
  const ch = periodKPIs.changes

  // Margin alerts
  if (c.margin < 10) {
    alerts.push({
      id: id(), severity: 'critical', category: 'Margin',
      title: 'Overall margin critically low',
      detail: `Current margin is ${c.margin.toFixed(1)}% — below 10% threshold.`,
      value: `${c.margin.toFixed(1)}%`, metric: 'margin',
    })
  } else if (c.margin < 15) {
    alerts.push({
      id: id(), severity: 'warning', category: 'Margin',
      title: 'Overall margin below target',
      detail: `Current margin is ${c.margin.toFixed(1)}% — below 15% target.`,
      value: `${c.margin.toFixed(1)}%`, metric: 'margin',
    })
  }

  // Margin decline
  if (ch.margin < -10) {
    alerts.push({
      id: id(), severity: 'critical', category: 'Margin',
      title: 'Margin dropped sharply vs prior period',
      detail: `Margin declined ${Math.abs(ch.margin).toFixed(1)}% vs prior period.`,
      value: `${ch.margin.toFixed(1)}%`, metric: 'margin',
    })
  } else if (ch.margin < -5) {
    alerts.push({
      id: id(), severity: 'warning', category: 'Margin',
      title: 'Margin trending down vs prior period',
      detail: `Margin declined ${Math.abs(ch.margin).toFixed(1)}% vs prior period.`,
      value: `${ch.margin.toFixed(1)}%`, metric: 'margin',
    })
  }

  // Revenue decline
  if (ch.revenue < -15) {
    alerts.push({
      id: id(), severity: 'critical', category: 'Revenue',
      title: 'Revenue dropped significantly vs prior period',
      detail: `Revenue is down ${Math.abs(ch.revenue).toFixed(1)}% vs prior period.`,
      value: `${ch.revenue.toFixed(1)}%`, metric: 'revenue',
    })
  } else if (ch.revenue < -5) {
    alerts.push({
      id: id(), severity: 'warning', category: 'Revenue',
      title: 'Revenue declining vs prior period',
      detail: `Revenue is down ${Math.abs(ch.revenue).toFixed(1)}% vs prior period.`,
      value: `${ch.revenue.toFixed(1)}%`, metric: 'revenue',
    })
  }

  // Customer concentration
  const totalRevenue = c.revenue
  if (totalRevenue > 0 && customerRevenues.length > 0) {
    const top1Pct = safeDiv(customerRevenues[0]?.revenue ?? 0, totalRevenue) * 100
    if (top1Pct > 40) {
      alerts.push({
        id: id(), severity: 'critical', category: 'Concentration',
        title: 'Single customer represents >40% of revenue',
        detail: `${customerRevenues[0].name} is ${top1Pct.toFixed(1)}% of total revenue.`,
        value: `${top1Pct.toFixed(1)}%`, metric: 'concentration',
      })
    } else if (top1Pct > 25) {
      alerts.push({
        id: id(), severity: 'warning', category: 'Concentration',
        title: 'Single customer represents >25% of revenue',
        detail: `${customerRevenues[0].name} is ${top1Pct.toFixed(1)}% of total revenue.`,
        value: `${top1Pct.toFixed(1)}%`, metric: 'concentration',
      })
    }
  }

  // Low load volume
  if (c.loadCount < 10) {
    alerts.push({
      id: id(), severity: 'info', category: 'Volume',
      title: 'Low load count in selected period',
      detail: `Only ${c.loadCount} loads in the selected date range — metrics may not be representative.`,
      value: String(c.loadCount), metric: 'loadCount',
    })
  }

  // Discount leakage
  const discountedCount = loads.filter(l =>
    (l.quote_orig_rev ?? 0) > 0 && (l.load_revenue ?? 0) < (l.quote_orig_rev ?? 0)
  ).length
  const discountPct = safeDiv(discountedCount, loads.length) * 100
  if (discountPct > 30) {
    alerts.push({
      id: id(), severity: 'warning', category: 'Discounts',
      title: 'High discount rate detected',
      detail: `${discountPct.toFixed(1)}% of loads were sold below original quote price.`,
      value: `${discountPct.toFixed(1)}%`, metric: 'discounts',
    })
  }

  return alerts.sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 }
    return order[a.severity] - order[b.severity]
  })
}
