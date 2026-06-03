import { useMemo } from 'react'
import { useAnalytics } from '../AnalyticsApp'
import { calcPeriodKPIs, calcEntitySummaries } from '../lib/calculations'
import { generateAlerts } from '../lib/alerts'
import styles from './AlertsPage.module.css'

export default function AlertsPage() {
  const { filteredLoads, filters } = useAnalytics()

  const period = useMemo(() =>
    calcPeriodKPIs(filteredLoads, filters.dateFrom, filters.dateTo),
    [filteredLoads, filters]
  )
  const customerSummaries = useMemo(() =>
    calcEntitySummaries(filteredLoads, 'customer_name'),
    [filteredLoads]
  )
  const alerts = useMemo(() =>
    generateAlerts(filteredLoads, period, customerSummaries),
    [filteredLoads, period, customerSummaries]
  )

  const criticals = alerts.filter(a => a.severity === 'critical')
  const warnings  = alerts.filter(a => a.severity === 'warning')
  const infos     = alerts.filter(a => a.severity === 'info')

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Alerts</h1>
        <div className={styles.summary}>
          {criticals.length > 0 && <span className={styles.critBadge}>{criticals.length} Critical</span>}
          {warnings.length  > 0 && <span className={styles.warnBadge}>{warnings.length} Warning</span>}
          {infos.length     > 0 && <span className={styles.infoBadge}>{infos.length} Info</span>}
          {alerts.length === 0   && <span className={styles.okBadge}>All Clear ✓</span>}
        </div>
      </div>

      {alerts.length === 0 && (
        <div className={styles.empty}>
          No alerts for the selected period and filters.
        </div>
      )}

      {[...criticals, ...warnings, ...infos].map(a => (
        <div key={a.id} className={`${styles.alert} ${styles[a.severity]}`}>
          <div className={styles.alertLeft}>
            <span className={`${styles.dot} ${styles[`dot_${a.severity}`]}`} />
          </div>
          <div className={styles.alertBody}>
            <div className={styles.alertMeta}>
              <span className={styles.alertCat}>{a.category}</span>
              <span className={`${styles.alertSeverity} ${styles[`sev_${a.severity}`]}`}>
                {a.severity.charAt(0).toUpperCase() + a.severity.slice(1)}
              </span>
            </div>
            <div className={styles.alertTitle}>{a.title}</div>
            <div className={styles.alertDetail}>{a.detail}</div>
          </div>
          {a.value && (
            <div className={`${styles.alertValue} ${styles[`val_${a.severity}`]}`}>
              {a.value}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
