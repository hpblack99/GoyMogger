import { useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { useAnalytics } from '../AnalyticsApp'
import { identifyAccessorialFrequency } from '../lib/calculations'
import styles from './ChargePage.module.css'

export default function ChargePage() {
  const { filteredLoads } = useAnalytics()

  const freqData = useMemo(() => {
    const freq = identifyAccessorialFrequency(filteredLoads)
    return Object.entries(freq)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 20)
      .map(([name, count]) => ({ name, count }))
  }, [filteredLoads])

  const totalWithAccessorials = useMemo(() =>
    filteredLoads.filter(l => {
      const raw = l.load_accessorials || l.quote_response_accessorials
      return raw && raw !== '0' && raw.trim() !== ''
    }).length,
    [filteredLoads]
  )

  const accessorialPct = filteredLoads.length
    ? (totalWithAccessorials / filteredLoads.length) * 100
    : 0

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Accessorial Charges</h1>

      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Loads with Accessorials</div>
          <div className={styles.statValue}>{totalWithAccessorials.toLocaleString()}</div>
          <div className={styles.statSub}>{accessorialPct.toFixed(1)}% of all loads</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Unique Accessorial Types</div>
          <div className={styles.statValue}>{freqData.length}</div>
        </div>
      </div>

      <div className={styles.chartCard}>
        <div className={styles.chartTitle}>Top 20 Accessorials by Frequency</div>
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={freqData} layout="vertical" margin={{ top: 4, right: 16, left: 200, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#21262d" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: '#6e7681' }} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#c9d1d9' }} tickLine={false} axisLine={false} width={195} />
            <Tooltip contentStyle={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8 }}
              labelStyle={{ color: '#c9d1d9' }} itemStyle={{ color: '#22c55e' }} />
            <Bar dataKey="count" name="Frequency" fill="#22c55e" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
