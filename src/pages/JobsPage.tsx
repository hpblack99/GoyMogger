import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import styles from './JobsPage.module.css'

interface QuoteJob {
  id: string
  name?: string
  status: 'pending' | 'running' | 'complete' | 'error'
  total_rows: number
  done_rows: number
  error?: string
  created_at: string
  updated_at: string
}

type Filter = 'all' | 'pending' | 'running' | 'complete' | 'error'

function fmtDate(iso: string) {
  const d = new Date(iso)
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  )
}

function JobBadge({ status }: { status: QuoteJob['status'] }) {
  const map = {
    pending:  { label: 'Pending',  cls: styles.badgePending  },
    running:  { label: 'Running',  cls: styles.badgeRunning  },
    complete: { label: 'Complete', cls: styles.badgeComplete },
    error:    { label: 'Error',    cls: styles.badgeError    },
  }
  const { label, cls } = map[status]
  return <span className={`${styles.badge} ${cls}`}>{label}</span>
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<QuoteJob[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [requeueingId, setRequeuingId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const loadJobs = () =>
    supabase
      .from('quote_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => { setJobs((data as QuoteJob[]) ?? []); setLoading(false) })

  useEffect(() => {
    loadJobs()
    const channel = supabase
      .channel('jobs-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quote_jobs' }, loadJobs)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = filter === 'all' ? jobs : jobs.filter((j) => j.status === filter)

  const counts = {
    all:      jobs.length,
    pending:  jobs.filter((j) => j.status === 'pending').length,
    running:  jobs.filter((j) => j.status === 'running').length,
    complete: jobs.filter((j) => j.status === 'complete').length,
    error:    jobs.filter((j) => j.status === 'error').length,
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    await supabase.from('quote_jobs').delete().eq('id', id)
    setJobs((prev) => prev.filter((j) => j.id !== id))
    setDeletingId(null)
    setConfirmDelete(null)
  }

  const handleRequeue = async (job: QuoteJob) => {
    setRequeuingId(job.id)
    // Reset job and all its rows back to pending
    await Promise.all([
      supabase.from('quote_jobs').update({ status: 'pending', done_rows: 0, error: null }).eq('id', job.id),
      supabase.from('quote_rows').update({ status: 'pending', rate: null, transit_days: null, quote_number: null, error: null }).eq('job_id', job.id),
    ])
    setRequeuingId(null)
  }

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all',      label: 'All'      },
    { key: 'pending',  label: 'Pending'  },
    { key: 'running',  label: 'Running'  },
    { key: 'complete', label: 'Complete' },
    { key: 'error',    label: 'Errors'   },
  ]

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>All Quotes</h1>
          <p className={styles.pageSubtitle}>Manage and monitor all FFE quoting jobs.</p>
        </div>
        <Link to="/quoter" className={styles.btnPrimary}>+ New Job</Link>
      </div>

      {/* Filter tabs */}
      <div className={styles.filterBar}>
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            className={`${styles.filterTab} ${filter === key ? styles.filterTabActive : ''}`}
            onClick={() => setFilter(key)}
          >
            {label}
            <span className={`${styles.filterCount} ${filter === key ? styles.filterCountActive : ''}`}>
              {counts[key]}
            </span>
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className={styles.emptyState}><span className={styles.spinner} /></div>
      ) : filtered.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyText}>No {filter === 'all' ? '' : filter + ' '}jobs found.</p>
          {filter === 'all' && <Link to="/quoter" className={styles.btnPrimary}>Submit your first job →</Link>}
        </div>
      ) : (
        <div className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Quote Name</th>
                <th>Submitted</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Rows</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((j) => {
                const pct = j.total_rows > 0 ? Math.round((j.done_rows / j.total_rows) * 100) : 0
                const isDeleting  = deletingId === j.id
                const isRequeueing = requeueingId === j.id
                const canRequeue = j.status === 'complete' || j.status === 'error'
                const canCancel  = j.status === 'pending' || j.status === 'running'

                return (
                  <tr key={j.id} className={isDeleting ? styles.rowFading : ''}>
                    <td>
                      <Link to={`/jobs/${j.id}`} className={styles.jobLink}>
                        {j.name || j.id.slice(0, 8).toUpperCase()}
                      </Link>
                      {j.error && (
                        <p className={styles.errorSnippet} title={j.error}>
                          {j.error.slice(0, 60)}{j.error.length > 60 ? '…' : ''}
                        </p>
                      )}
                    </td>
                    <td className={styles.dateCell}>{fmtDate(j.created_at)}</td>
                    <td><JobBadge status={j.status} /></td>
                    <td>
                      <div className={styles.progressWrap}>
                        <div className={styles.progressBar}>
                          <div
                            className={`${styles.progressFill} ${j.status === 'running' ? styles.progressAnimated : ''}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className={styles.progressLabel}>{j.done_rows}/{j.total_rows}</span>
                      </div>
                    </td>
                    <td className={styles.totalCell}>{j.total_rows}</td>
                    <td>
                      <div className={styles.actions}>
                        <Link to={`/jobs/${j.id}`} className={styles.btnAction}>View</Link>

                        {canRequeue && (
                          <button
                            className={styles.btnAction}
                            onClick={() => handleRequeue(j)}
                            disabled={isRequeueing}
                          >
                            {isRequeueing ? '…' : 'Re-queue'}
                          </button>
                        )}

                        {canCancel && (
                          <button
                            className={`${styles.btnAction} ${styles.btnDanger}`}
                            onClick={() => handleRequeue({ ...j, status: 'error' })}
                          >
                            Cancel
                          </button>
                        )}

                        {confirmDelete === j.id ? (
                          <>
                            <button
                              className={`${styles.btnAction} ${styles.btnDanger}`}
                              onClick={() => handleDelete(j.id)}
                              disabled={isDeleting}
                            >
                              {isDeleting ? '…' : 'Confirm'}
                            </button>
                            <button className={styles.btnAction} onClick={() => setConfirmDelete(null)}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            className={`${styles.btnAction} ${styles.btnDanger}`}
                            onClick={() => setConfirmDelete(j.id)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
