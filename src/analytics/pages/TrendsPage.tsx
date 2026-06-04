import { useState } from 'react'
import { useAnalytics } from '../AnalyticsApp'

import type { TrendGranularity } from '../lib/calculations'
import { useMultiTrend, SERIES_COLORS } from '../lib/useMultiSeries'
import TrendChart from '../components/TrendChart'
import type { EntityGroup } from '../components/TrendChart'
import styles from './TrendsPage.module.css'

export default function TrendsPage() {
  const { filteredLoads, filters } = useAnalytics()
  const [gran, setGran] = useState<TrendGranularity>('week')

  const { multi, chartData: weekData } = useMultiTrend(filteredLoads, filters, 'week')
  const { chartData: dayData }         = useMultiTrend(filteredLoads, filters, 'day')
  const { chartData: monthData }       = useMultiTrend(filteredLoads, filters, 'month')

  const multiKeys = multi?.keys ?? []

  // Entity groups for each metric
  const mkGroups = (seriesFn: (key: string) => EntityGroup['series']): EntityGroup[] =>
    multiKeys.map((key, i) => ({
      label: key,
      color: SERIES_COLORS[(i + 1) % SERIES_COLORS.length],
      series: seriesFn(key),
    }))

  const revProfitGroups = mkGroups(key => [
    { dataKey: `rev_${key}`,    name: 'Rev',    shape: 'line' as const },
    { dataKey: `profit_${key}`, name: 'Profit', shape: 'line' as const },
    { dataKey: `margin_${key}`, name: 'Margin', shape: 'line' as const, rightAxis: true },
  ])

  const loadGroups = mkGroups(key => [
    { dataKey: `loads_${key}`, name: 'Loads', shape: 'line' as const },
  ])

  const perLoadGroups = mkGroups(key => [
    { dataKey: `revPerLoad_${key}`,    name: 'Rev/Load',    shape: 'line' as const },
    { dataKey: `profitPerLoad_${key}`, name: 'Profit/Load', shape: 'line' as const },
  ])

  const revProfitGross = multi ? [
    { dataKey: 'gross_revenue', name: 'Revenue (Gross)', color: '#22c55e', shape: 'bar'  as const },
    { dataKey: 'gross_profit',  name: 'Profit (Gross)',  color: '#06b6d4', shape: 'bar'  as const },
    { dataKey: 'gross_margin',  name: 'Margin (Gross)',  color: '#f59e0b', shape: 'line' as const, rightAxis: true },
  ] : [
    { dataKey: 'revenue', name: 'Revenue', color: '#22c55e', shape: 'bar'  as const },
    { dataKey: 'profit',  name: 'Profit',  color: '#06b6d4', shape: 'bar'  as const },
    { dataKey: 'margin',  name: 'Margin',  color: '#f59e0b', shape: 'line' as const, rightAxis: true },
  ]

  const loadGross = multi
    ? [{ dataKey: 'gross_loadCount', name: 'Loads (Gross)', color: '#8b5cf6', shape: 'bar' as const }]
    : [{ dataKey: 'loadCount', name: 'Loads', color: '#8b5cf6', shape: 'bar' as const }]

  const perLoadGross = multi ? [
    { dataKey: 'gross_revenuePerLoad',  name: 'Rev/Load (Gross)',    color: '#22c55e', shape: 'line' as const },
    { dataKey: 'gross_profitPerLoad',   name: 'Profit/Load (Gross)', color: '#06b6d4', shape: 'line' as const },
  ] : [
    { dataKey: 'revenuePerLoad',  name: 'Rev / Load',    color: '#22c55e', shape: 'line' as const },
    { dataKey: 'profitPerLoad',   name: 'Profit / Load', color: '#06b6d4', shape: 'line' as const },
  ]

  const granLabel = gran.charAt(0).toUpperCase() + gran.slice(1)

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Trends</h1>
      </div>

      <TrendChart
        title={`Revenue & Profit by ${granLabel}`}
        weekData={weekData} dayData={dayData} monthData={monthData}
        grossSeries={revProfitGross}
        entityGroups={revProfitGroups}
        valueType="dollar" rightValueType="pct"
        height={260}
        gran={gran} onGranChange={setGran}
      />

      <TrendChart
        title={`Load Count by ${granLabel}`}
        weekData={weekData} dayData={dayData} monthData={monthData}
        grossSeries={loadGross}
        entityGroups={loadGroups}
        valueType="count"
        height={200}
        gran={gran} onGranChange={setGran}
      />

      <TrendChart
        title={`Revenue & Profit per Load by ${granLabel}`}
        weekData={weekData} dayData={dayData} monthData={monthData}
        grossSeries={perLoadGross}
        entityGroups={perLoadGroups}
        valueType="dollar2"
        height={200}
        gran={gran} onGranChange={setGran}
      />
    </div>
  )
}
