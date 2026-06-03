import { useMemo } from 'react'
import { useAnalytics } from '../AnalyticsApp'
import { calcDiscountAnalysis, fmt, safeDiv } from '../lib/calculations'
import KPICard from '../components/KPICard'
import DataTable from '../components/DataTable'
import type { Column } from '../components/DataTable'
import styles from './DiscountPage.module.css'

export default function DiscountPage() {
  const { filteredLoads } = useAnalytics()

  const disc = useMemo(() => calcDiscountAnalysis(filteredLoads), [filteredLoads])

  const discByCustomer = useMemo(() => {
    const map: Record<string, { gross: number; net: number; count: number }> = {}
    filteredLoads.forEach(l => {
      const gross = l.quote_orig_rev ?? 0
      const net = l.load_revenue ?? 0
      if (gross <= 0) return
      const cust = l.customer_name ?? 'Unknown'
      if (!map[cust]) map[cust] = { gross: 0, net: 0, count: 0 }
      map[cust].gross += gross
      map[cust].net += net
      if (net < gross) map[cust].count += 1
    })
    return Object.entries(map)
      .map(([name, { gross, net, count }]) => ({
        name,
        grossRevenue:  gross,
        netRevenue:    net,
        totalDiscount: gross - net,
        discountPct:   safeDiv(gross - net, gross) * 100,
        discountedLoads: count,
      }))
      .filter(x => x.totalDiscount > 0)
      .sort((a, b) => b.totalDiscount - a.totalDiscount)
  }, [filteredLoads])

  const discByRep = useMemo(() => {
    const map: Record<string, { gross: number; net: number; count: number }> = {}
    filteredLoads.forEach(l => {
      const gross = l.quote_orig_rev ?? 0
      const net = l.load_revenue ?? 0
      if (gross <= 0) return
      const rep = l.sales_rep ?? 'Unknown'
      if (!map[rep]) map[rep] = { gross: 0, net: 0, count: 0 }
      map[rep].gross += gross
      map[rep].net += net
      if (net < gross) map[rep].count += 1
    })
    return Object.entries(map)
      .map(([name, { gross, net, count }]) => ({
        name,
        totalDiscount: gross - net,
        discountPct:   safeDiv(gross - net, gross) * 100,
        discountedLoads: count,
      }))
      .filter(x => x.totalDiscount > 0)
      .sort((a, b) => b.totalDiscount - a.totalDiscount)
  }, [filteredLoads])

  type DiscRow = typeof discByCustomer[0]
  const custCols: Column<DiscRow>[] = [
    { key: 'name',            header: 'Customer' },
    { key: 'discountedLoads', header: 'Disc. Loads',    align: 'right' },
    { key: 'totalDiscount',   header: 'Total Discount', align: 'right', render: r => fmt.dollar(r.totalDiscount) },
    { key: 'discountPct',     header: 'Disc. %',        align: 'right', render: r => fmt.pct(r.discountPct) },
    { key: 'netRevenue',      header: 'Net Revenue',    align: 'right', render: r => fmt.dollar(r.netRevenue) },
  ]

  type RepRow = typeof discByRep[0]
  const repCols: Column<RepRow>[] = [
    { key: 'name',            header: 'Rep' },
    { key: 'discountedLoads', header: 'Disc. Loads',    align: 'right' },
    { key: 'totalDiscount',   header: 'Total Discount', align: 'right', render: r => fmt.dollar(r.totalDiscount) },
    { key: 'discountPct',     header: 'Disc. %',        align: 'right', render: r => fmt.pct(r.discountPct) },
  ]

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Discount Analysis</h1>

      <div className={styles.kpiGrid}>
        <KPICard label="Total Discounts Given"    value={fmt.dollar(disc.totalDiscount)} />
        <KPICard label="Overall Discount Rate"    value={fmt.pct(disc.discountPct)} />
        <KPICard label="Discounted Load Count"    value={fmt.num(disc.discountedLoadCount)} />
        <KPICard label="Avg Discount per Load"    value={fmt.dollar(disc.avgDiscountPerLoad)} />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Discounts by Customer</div>
        <DataTable columns={custCols} rows={discByCustomer} rowKey={r => r.name} emptyMessage="No discount data" maxRows={15} />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Discounts by Sales Rep</div>
        <DataTable columns={repCols} rows={discByRep} rowKey={r => r.name} emptyMessage="No discount data" />
      </div>
    </div>
  )
}
