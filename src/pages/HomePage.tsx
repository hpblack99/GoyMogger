import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import styles from './HomePage.module.css'

interface JobSummary {
  id: string
  status: 'pending' | 'running' | 'complete' | 'error'
  total_rows: number
  done_rows: number
  created_at: string
}

function calcStats(jobs: JobSummary[]) {
  const total = jobs.length
  const active = jobs.filter((j) => j.status === 'pending' || j.status === 'running').length
  const complete = jobs.filter((j) => j.status === 'complete').length
  const totalRowsQuoted = jobs.reduce((s, j) => s + (j.done_rows ?? 0), 0)
  return { total, active, complete, totalRowsQuoted }
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  )
}

function JobBadge({ status }: { status: JobSummary['status'] }) {
  const map = {
    pending:  { label: 'Pending',  cls: styles.badgePending  },
    running:  { label: 'Running',  cls: styles.badgeRunning  },
    complete: { label: 'Complete', cls: styles.badgeComplete },
    error:    { label: 'Error',    cls: styles.badgeError    },
  }
  const { label, cls } = map[status]
  return <span className={`${styles.badge} ${cls}`}>{label}</span>
}

export default function HomePage() {
  const [jobs, setJobs] = useState<JobSummary[]>([])
  const [loading, setLoading] = useState(true)

  const loadJobs = () =>
    supabase
      .from('quote_jobs')
      .select('id, status, total_rows, done_rows, created_at')
      .order('created_at', { ascending: false })
      .then(({ data }) => { setJobs((data as JobSummary[]) ?? []); setLoading(false) })

  useEffect(() => {
    loadJobs()
    const channel = supabase
      .channel('dashboard-jobs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quote_jobs' }, loadJobs)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const stats = calcStats(jobs)
  const recent = jobs.slice(0, 8)

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <div>
          <h1 className={styles.title}>FFE Quote Bot</h1>
          <p className={styles.subtitle}>
            Upload shipment spreadsheets, get reefer LTL rates from Frozen Food Express automatically.
          </p>
        </div>
        <Link to="/quoter" className={styles.ctaBtn}>Submit New Quote Job →</Link>
      </div>

      {/* Stats */}
      <div className={styles.statsGrid}>
        <StatCard label="Total Jobs" value={loading ? '—' : stats.total} />
        <StatCard label="Active Now" value={loading ? '—' : stats.active} highlight={stats.active > 0} />
        <StatCard label="Completed" value={loading ? '—' : stats.complete} />
        <StatCard label="Rows Quoted" value={loading ? '—' : stats.totalRowsQuoted.toLocaleString()} />
      </div>

      {/* Recent jobs */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Recent Jobs</h2>
          <Link to="/jobs" className={styles.viewAll}>Manage all jobs →</Link>
        </div>

        {loading ? (
          <div className={styles.emptyState}><span className={styles.spinner} /></div>
        ) : jobs.length === 0 ? (
          <div className={styles.emptyState}>
            <p className={styles.emptyText}>No jobs submitted yet.</p>
            <Link to="/quoter" className={styles.ctaBtn}>Submit your first job →</Link>
          </div>
        ) : (
          <div className={styles.tableCard}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Job ID</th>
                  <th>Submitted</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {recent.map((j) => {
                  const pct = j.total_rows > 0 ? Math.round((j.done_rows / j.total_rows) * 100) : 0
                  return (
                    <tr key={j.id}>
                      <td className={styles.jobIdCell}>{j.id.slice(0, 8).toUpperCase()}</td>
                      <td className={styles.dateCell}>{fmtDate(j.created_at)}</td>
                      <td><JobBadge status={j.status} /></td>
                      <td>
                        <div className={styles.miniProgress}>
                          <div className={styles.miniBar}>
                            <div className={styles.miniFill} style={{ width: `${pct}%` }} />
                          </div>
                          <span className={styles.miniLabel}>{j.done_rows}/{j.total_rows}</span>
                        </div>
                      </td>
                      <td>
                        <Link to={`/jobs/${j.id}`} className={styles.viewLink}>View →</Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, highlight = false }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className={`${styles.statCard} ${highlight ? styles.statCardHighlight : ''}`}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  )
}
