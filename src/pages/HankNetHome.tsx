import { Link } from 'react-router-dom'
import styles from './HankNetHome.module.css'

const TOOLS = [
  {
    path: '/reefer',
    name: 'ReeferByHank',
    tagline: 'LTL Reefer Quote Engine',
    description: 'Submit bulk reefer LTL shipments and instantly compare FFE and FreshX rates. Get the lowest-cost carrier in minutes.',
    icon: '❄',
    color: '#06b6d4',
  },
  {
    path: '/analytics',
    name: 'Freight Analytics',
    tagline: 'Executive Dashboard',
    description: 'Upload 365-day load history and explore revenue, margin, customer performance, sales rep analytics, trends, and alerts.',
    icon: '▦',
    color: '#22c55e',
  },
]

export default function HankNetHome() {
  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <div className={styles.logoMark}>HN</div>
        <h1 className={styles.suiteName}>HankNet</h1>
        <p className={styles.suiteTagline}>Freight intelligence, in one place</p>
      </div>

      <div className={styles.toolGrid}>
        {TOOLS.map(t => (
          <Link key={t.path} to={t.path} className={styles.toolCard}>
            <div className={styles.toolIcon} style={{ color: t.color, background: `${t.color}18` }}>
              {t.icon}
            </div>
            <div className={styles.toolInfo}>
              <div className={styles.toolName}>{t.name}</div>
              <div className={styles.toolTagline} style={{ color: t.color }}>{t.tagline}</div>
              <div className={styles.toolDesc}>{t.description}</div>
            </div>
            <div className={styles.arrow} style={{ color: t.color }}>→</div>
          </Link>
        ))}
      </div>
    </div>
  )
}
