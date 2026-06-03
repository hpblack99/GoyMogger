import styles from './KPICard.module.css'

interface Props {
  label: string
  value: string
  change?: number
  sub?: string
  accent?: boolean
}

export default function KPICard({ label, value, change, sub, accent }: Props) {
  const hasChange = change !== undefined
  const up = (change ?? 0) >= 0
  return (
    <div className={`${styles.card} ${accent ? styles.accent : ''}`}>
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>{value}</div>
      {hasChange && (
        <div className={`${styles.change} ${up ? styles.up : styles.down}`}>
          {up ? '▲' : '▼'} {Math.abs(change!).toFixed(1)}% vs prior
        </div>
      )}
      {sub && <div className={styles.sub}>{sub}</div>}
    </div>
  )
}
