import type { Load, ChargeCategory } from './types'
import { safeDiv } from './calculations'

// Map charge description keywords to categories
const CATEGORY_MAP: [RegExp, string][] = [
  [/fuel/i, 'Fuel Surcharge'],
  [/lift ?gate|liftgate/i, 'Liftgate'],
  [/resid/i, 'Residential Delivery'],
  [/appt|appointment/i, 'Appointment'],
  [/inside/i, 'Inside Delivery/Pickup'],
  [/hazmat|hazardous/i, 'Hazmat'],
  [/over ?size|oversize/i, 'Oversize'],
  [/over ?weight|overweight/i, 'Overweight'],
  [/storag/i, 'Storage'],
  [/redelivery/i, 'Redelivery'],
  [/notify|notification/i, 'Notification'],
  [/sort|segregat/i, 'Sort & Segregate'],
  [/protect|freeze/i, 'Protect from Freeze'],
]

export function categorizeAccessorial(raw: string): string {
  for (const [re, cat] of CATEGORY_MAP) {
    if (re.test(raw)) return cat
  }
  return 'Other Accessorial'
}

export function calcChargeCategories(loads: Load[]): ChargeCategory[] {
  const cats: Record<string, { total: number; loadCount: number }> = {}

  loads.forEach(l => {
    const raw = l.load_accessorials || l.quote_response_accessorials
    if (!raw || raw === '0' || raw.trim() === '') return
    raw.split(/[,;|]/).forEach(part => {
      const acc = part.trim()
      if (!acc) return
      const cat = categorizeAccessorial(acc)
      if (!cats[cat]) cats[cat] = { total: 0, loadCount: 0 }
      cats[cat].loadCount += 1
      // We don't have per-accessorial dollar amounts in the loads table,
      // so we approximate proportionally — this is a frequency view
    })
  })

  const totalLoads = loads.length || 1
  return Object.entries(cats).map(([name, { loadCount }]) => ({
    name,
    total: 0,      // requires load_charges join — populated elsewhere
    pct: safeDiv(loadCount, totalLoads) * 100,
    loadCount,
    avgPerLoad: 0, // populated from load_charges when available
  })).sort((a, b) => b.loadCount - a.loadCount)
}
