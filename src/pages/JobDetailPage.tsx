import { useState, useEffect, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { ACCESSORIAL_MAP } from '../lib/accessorials'
import styles from './JobDetailPage.module.css'

interface QuoteJob {
  id: string
  name?: string
  status: 'pending' | 'running' | 'complete' | 'error'
  total_rows: number
  done_rows: number
  error?: string
  created_at: string
  updated_at: string
  accessorials?: string[]
  temperature?:  string
  commodity?:    string
  is_stackable?: boolean
}

interface QuoteRow {
  id: string
  job_id: string
  row_index: number
  origin_zip: string
  dest_zip: string
  weight: number
  freight_class: string
  pieces?: number
  commodity?: string
  pallets?: number
  status: 'pending' | 'processing' | 'complete' | 'error'
  rate?: string
  transit_days?: string
  quote_number?: string
  error?: string
  freshx_rate?:    string
  freshx_carrier?: string
  winning_rate?:    string
  winning_carrier?: string
  winning_source?:  string
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  return (
    d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) +
    ' at ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  )
}

function JobBadge({ status, paused }: { status: QuoteJob['status']; paused?: boolean }) {
  if (paused && status === 'running') {
    return <span className={`${styles.badge} ${styles.badgePaused}`}>Paused</span>
  }
  const map = {
    pending:  { label: 'Pending',  cls: styles.badgePending  },
    running:  { label: 'Running',  cls: styles.badgeRunning  },
    complete: { label: 'Complete', cls: styles.badgeComplete },
    error:    { label: 'Error',    cls: styles.badgeError    },
  }
  const { label, cls } = map[status]
  return <span className={`${styles.badge} ${cls}`}>{label}</span>
}

function RowBadge({ status }: { status: QuoteRow['status'] }) {
  const map = {
    pending:    { label: 'Pending',      cls: styles.badgePending    },
    processing: { label: 'Processing…',  cls: styles.badgeRunning    },
    complete:   { label: 'Complete',     cls: styles.badgeComplete   },
    error:      { label: 'Error',        cls: styles.badgeError      },
  }
  const { label, cls } = map[status]
  return <span className={`${styles.badge} ${cls}`}>{label}</span>
}

function parseCost(rateStr: string | null | undefined): number | null {
  if (!rateStr) return null
  const n = parseFloat(rateStr.replace(/[$,]/g, ''))
  return isNaN(n) ? null : n
}

function calcPricing(rateStr: string | null | undefined, marginPct: number, minProfit: number, maxProfit: number) {
  const cost = parseCost(rateStr)
  if (cost === null || cost <= 0 || marginPct < 0 || marginPct >= 100) return null
  let sellPrice = cost / (1 - marginPct / 100)
  let gp = sellPrice - cost
  if (minProfit > 0 && gp < minProfit) { gp = minProfit; sellPrice = cost + minProfit }
  if (maxProfit > 0 && gp > maxProfit) { gp = maxProfit; sellPrice = cost + maxProfit }
  return { cost, sellPrice, gp }
}

function fmtMoney(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function downloadXlsx(job: QuoteJob, rows: QuoteRow[], marginPct: number, minProfit: number, maxProfit: number) {
  const data = rows.map((r) => {
    const p = calcPricing(r.winning_rate ?? r.rate, marginPct, minProfit, maxProfit)
    return {
      '#':               r.row_index,
      'Origin ZIP':      r.origin_zip,
      'Dest ZIP':        r.dest_zip,
      'Weight (lbs)':    r.weight,
      'Pallets':         r.pallets ?? '',
      'Class':           r.freight_class,
      'FFE Cost':        r.rate ?? '',
      'FreshX Rate':     r.freshx_rate ?? '',
      'FreshX Carrier':  r.freshx_carrier ?? '',
      'Winning Rate':    r.winning_rate ?? '',
      'Winning Carrier': r.winning_carrier ?? '',
      'Source':          r.winning_source ?? '',
      'Sell Price':      p ? fmtMoney(p.sellPrice) : '',
      'GP ($)':          p ? fmtMoney(p.gp) : '',
      'Margin %':        p ? ((p.gp / p.sellPrice) * 100).toFixed(1) + '%' : '',
      'Transit Days':    r.transit_days ?? '',
      'Quote #':         r.quote_number ?? '',
      'Status':          r.status,
      'Notes':           r.error ?? '',
    }
  })
  const ws = XLSX.utils.json_to_sheet(data)
  ws['!cols'] = [4,12,12,14,8,8,14,14,18,14,18,8,14,12,12,14,14,10,30].map((w) => ({ wch: w }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Reefer Quotes')
  const safe = (job.name?.trim() || 'Quotes').replace(/[\/\\?%*:|"<>]/g, '-')
  XLSX.writeFile(wb, `${safe} Reefer Quotes.xlsx`)
}

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [job, setJob] = useState<QuoteJob | null>(null)
  const [rows, setRows] = useState<QuoteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [requeueing, setRequeueing] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | QuoteRow['status']>('all')
  const [marginPct,    setMarginPct]    = useState(15)
  const [minProfit,    setMinProfit]    = useState(75)
  const [maxProfit,    setMaxProfit]    = useState(500)
  const [now, setNow] = useState(() => Date.now())
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!id) return

    Promise.all([
      supabase.from('quote_jobs').select('*').eq('id', id).single(),
      supabase.from('quote_rows').select('*').eq('job_id', id).order('row_index'),
    ]).then(([{ data: jobData, error }, { data: rowData }]) => {
      if (error || !jobData) { setNotFound(true); setLoading(false); return }
      setJob(jobData as QuoteJob)
      setRows((rowData as QuoteRow[]) ?? [])
      setLoading(false)
    })

    const channel = supabase
      .channel(`job-detail-${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'quote_jobs', filter: `id=eq.${id}` },
        (payload) => {
          if (payload.eventType !== 'DELETE') setJob(payload.new as QuoteJob)
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'quote_rows', filter: `job_id=eq.${id}` },
        (payload) => {
          if (payload.eventType === 'UPDATE') {
            setRows((prev) => prev.map((r) => (r.id === (payload.new as QuoteRow).id ? payload.new as QuoteRow : r)))
          } else if (payload.eventType === 'INSERT') {
            const row = payload.new as QuoteRow
            setRows((prev) => prev.some((r) => r.id === row.id) ? prev : [...prev, row].sort((a, b) => a.row_index - b.row_index))
          }
        }
      )
      .subscribe()

    let pollId: ReturnType<typeof setInterval>
    pollId = setInterval(async () => {
      const { data: jobData } = await supabase.from('quote_jobs').select('*').eq('id', id).single()
      if (!jobData) return
      setJob(jobData as QuoteJob)
      const { data: rowData } = await supabase.from('quote_rows').select('*').eq('job_id', id).order('row_index')
      if (rowData) setRows(rowData as QuoteRow[])
      if (jobData.status === 'complete' || jobData.status === 'error') clearInterval(pollId)
    }, 3_000)

    channelRef.current = channel
    return () => { supabase.removeChannel(channel); clearInterval(pollId) }
  }, [id])

  const handleDelete = async () => {
    if (!job) return
    setDeleting(true)
    await supabase.from('quote_jobs').delete().eq('id', job.id)
    navigate('/jobs')
  }

  const handleRequeue = async () => {
    if (!job) return
    setRequeueing(true)
    const isFullReset = job.status === 'complete'
    const doneCount   = isFullReset ? 0 : rows.filter((r) => r.status === 'complete').length
    const rowsQuery   = supabase.from('quote_rows')
      .update({ status: 'pending', rate: null, transit_days: null, quote_number: null, error: null })
      .eq('job_id', job.id)
    await Promise.all([
      supabase.from('quote_jobs').update({ status: 'pending', done_rows: doneCount, error: null }).eq('id', job.id),
      isFullReset ? rowsQuery : rowsQuery.neq('status', 'complete'),
    ])
    setRows((prev) => prev.map((r) =>
      isFullReset || r.status !== 'complete'
        ? { ...r, status: 'pending' as const, rate: undefined, transit_days: undefined, quote_number: undefined, error: undefined }
        : r
    ))
    setJob((j) => j ? { ...j, status: 'pending', done_rows: doneCount } : j)
    setRequeueing(false)
  }

  const handleRerunErrors = async () => {
    if (!job) return
    const resetIds  = rows.filter((r) => r.status === 'error' || r.status === 'processing').map((r) => r.id)
    const doneCount = rows.filter((r) => r.status === 'complete').length
    if (!resetIds.length) return
    await Promise.all([
      supabase.from('quote_rows')
        .update({ status: 'pending', rate: null, transit_days: null, quote_number: null, error: null })
        .in('id', resetIds),
      supabase.from('quote_jobs')
        .update({ status: 'pending', done_rows: doneCount, error: null })
        .eq('id', job.id),
    ])
    setRows((prev) => prev.map((r) =>
      r.status === 'error' || r.status === 'processing'
        ? { ...r, status: 'pending' as const, rate: undefined, transit_days: undefined, quote_number: undefined, error: undefined }
        : r
    ))
    setJob((j) => j ? { ...j, status: 'pending', done_rows: doneCount } : j)
  }

  if (loading) return (
    <div className={styles.centered}><span className={styles.spinner} /></div>
  )

  if (notFound) return (
    <div className={styles.centered}>
      <p className={styles.notFoundText}>Bid not found.</p>
      <Link to="/jobs" className={styles.btnSecondary}>← Back to Bids</Link>
    </div>
  )

  const job_ = job!
  const pct = job_.total_rows > 0 ? Math.round((job_.done_rows / job_.total_rows) * 100) : 0
  const completedCount = rows.filter((r) => r.status === 'complete').length
  const errorCount     = rows.filter((r) => r.status === 'error').length
  const isPaused = job_.status === 'running' && (now - new Date(job_.updated_at).getTime()) > 90_000

  const filteredRows = statusFilter === 'all' ? rows : rows.filter((r) => r.status === statusFilter)

  const rowCounts = {
    all:        rows.length,
    pending:    rows.filter((r) => r.status === 'pending').length,
    processing: rows.filter((r) => r.status === 'processing').length,
    complete:   rows.filter((r) => r.status === 'complete').length,
    error:      rows.filter((r) => r.status === 'error').length,
  }

  return (
    <div className={styles.page}>
      <div className={styles.breadcrumb}>
        <Link to="/jobs" className={styles.breadcrumbLink}>Bids</Link>
        <span className={styles.breadcrumbSep}>/</span>
        <span className={styles.breadcrumbCurrent}>{job_.id.slice(0, 8).toUpperCase()}</span>
      </div>

      <div className={styles.headerCard}>
        <div className={styles.headerTop}>
          <div className={styles.headerMeta}>
            {job_.name && <h2 className={styles.jobName}>{job_.name}</h2>}
            <div className={styles.headerTitleRow}>
              <h1 className={styles.jobTitle}>Bid {job_.id.slice(0, 8).toUpperCase()}</h1>
              <JobBadge status={job_.status} paused={isPaused} />
            </div>
            <p className={styles.jobDate}>Submitted {fmtDate(job_.created_at)}</p>
            {job_.error && <p className={styles.jobError}>{job_.error}</p>}
          </div>

          <div className={styles.headerActions}>
            {errorCount > 0 && (isPaused || job_.status === 'complete' || job_.status === 'error') && (
              <button className={styles.btnSecondary} onClick={handleRerunErrors}>
                ↺ Re-run {errorCount} Error{errorCount !== 1 ? 's' : ''}
              </button>
            )}
            {(job_.status === 'complete' || job_.status === 'error') && (
              <button className={styles.btnSecondary} onClick={handleRequeue} disabled={requeueing}>
                {requeueing ? 'Re-queuing…' : '↺ Re-queue All'}
              </button>
            )}
            {rows.length > 0 && (
              <button className={styles.btnPrimary} onClick={() => downloadXlsx(job_, rows, marginPct, minProfit, maxProfit)}>
                ↓ Download .xlsx
              </button>
            )}
            {confirmDelete ? (
              <>
                <button className={styles.btnDanger} onClick={handleDelete} disabled={deleting}>
                  {deleting ? 'Deleting…' : 'Confirm Delete'}
                </button>
                <button className={styles.btnSecondary} onClick={() => setConfirmDelete(false)}>Cancel</button>
              </>
            ) : (
              <button className={styles.btnDanger} onClick={() => setConfirmDelete(true)}>Delete Job</button>
            )}
          </div>
        </div>

        <div className={styles.statsRow}>
          <div className={styles.statItem}>
            <span className={styles.statNum}>{job_.total_rows}</span>
            <span className={styles.statLbl}>Total Rows</span>
          </div>
          <div className={styles.statItem}>
            <span className={`${styles.statNum} ${styles.statGreen}`}>{completedCount}</span>
            <span className={styles.statLbl}>Quoted</span>
          </div>
          <div className={styles.statItem}>
            <span className={`${styles.statNum} ${errorCount > 0 ? styles.statRed : ''}`}>{errorCount}</span>
            <span className={styles.statLbl}>Errors</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statNum}>{pct}%</span>
            <span className={styles.statLbl}>Complete</span>
          </div>
        </div>

        {job_.accessorials && job_.accessorials.length > 0 && (
          <div className={styles.accessorialsRow}>
            <span className={styles.accessorialsLbl}>Accessorials:</span>
            {job_.accessorials.map((key) => (
              <span key={key} className={styles.accessorialChip}>
                {ACCESSORIAL_MAP[key]?.label ?? key}
              </span>
            ))}
          </div>
        )}

        {(job_.temperature || job_.commodity) && (
          <div className={styles.freshxRow}>
            <span className={styles.freshxLbl}>FreshX:</span>
            {job_.temperature && <span className={styles.freshxChip}>{job_.temperature}</span>}
            {job_.commodity   && <span className={styles.freshxChip}>{job_.commodity}</span>}
            <span className={styles.freshxChip}>{job_.is_stackable ? 'Stackable' : 'Not Stackable'}</span>
          </div>
        )}

        {(job_.status === 'running' || job_.status === 'pending') && (
          <div className={styles.progressSection}>
            <div className={styles.progressBar}>
              <div
                className={`${styles.progressFill} ${job_.status === 'running' && !isPaused ? styles.progressAnimated : ''}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className={styles.progressLabel}>{job_.done_rows} / {job_.total_rows} rows</span>
          </div>
        )}
      </div>

      {(job_.status === 'pending' || isPaused) && (
        <div className={styles.workerHint}>
          <strong>{isPaused ? 'Worker stopped.' : 'Waiting for Python worker.'}</strong> Run <code>cd python && python worker.py</code> to {isPaused ? 'resume' : 'start'} processing.
        </div>
      )}

      {rows.some((r) => r.rate || r.winning_rate) && (
        <PricingPanel
          marginPct={marginPct} minProfit={minProfit} maxProfit={maxProfit}
          onMarginPct={setMarginPct} onMinProfit={setMinProfit} onMaxProfit={setMaxProfit}
          rows={rows}
        />
      )}

      <div className={styles.rowFilterBar}>
        {(['all', 'complete', 'error', 'processing', 'pending'] as const).map((s) => (
          <button
            key={s}
            className={`${styles.filterTab} ${statusFilter === s ? styles.filterTabActive : ''}`}
            onClick={() => setStatusFilter(s)}
          >
            {s === 'all' ? 'All Rows' : s.charAt(0).toUpperCase() + s.slice(1)}
            <span className={`${styles.filterCount} ${statusFilter === s ? styles.filterCountActive : ''}`}>
              {rowCounts[s]}
            </span>
          </button>
        ))}
      </div>

      <div className={styles.tableCard}>
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Origin ZIP</th>
                <th>Dest ZIP</th>
                <th>Weight</th>
                <th>Pallets</th>
                <th>Class</th>
                <th>Status</th>
                <th>FFE Cost</th>
                <th>FreshX Rate</th>
                <th>FreshX Carrier</th>
                <th>Winning Rate</th>
                <th>Carrier</th>
                <th>Source</th>
                <th>Sell Price</th>
                <th>GP ($)</th>
                <th>Transit Days</th>
                <th>Quote #</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => {
                const p = calcPricing(r.winning_rate ?? r.rate, marginPct, minProfit, maxProfit)
                return (
                  <tr
                    key={r.id}
                    className={
                      r.status === 'complete'   ? styles.rowComplete   :
                      r.status === 'error'      ? styles.rowError      :
                      r.status === 'processing' ? styles.rowProcessing : ''
                    }
                  >
                    <td className={styles.indexCell}>{r.row_index}</td>
                    <td>{r.origin_zip}</td>
                    <td>{r.dest_zip}</td>
                    <td>{r.weight.toLocaleString()}</td>
                    <td>{r.pallets ?? '—'}</td>
                    <td>{r.freight_class}</td>
                    <td><RowBadge status={r.status} /></td>
                    <td className={styles.rateCell}>{r.rate ?? '—'}</td>
                    <td className={styles.freshxCell}>{r.freshx_rate ?? '—'}</td>
                    <td className={styles.freshxCell}>{r.freshx_carrier ?? '—'}</td>
                    <td className={styles.winnerCell}>{r.winning_rate ?? '—'}</td>
                    <td>{r.winning_carrier ?? '—'}</td>
                    <td>
                      {r.winning_source
                        ? <span className={r.winning_source === 'FreshX' ? styles.sourceBadgeFreshx : styles.sourceBadgeFFE}>{r.winning_source}</span>
                        : '—'}
                    </td>
                    <td className={styles.sellCell}>{p ? fmtMoney(p.sellPrice) : '—'}</td>
                    <td className={styles.gpCell}>{p ? fmtMoney(p.gp) : '—'}</td>
                    <td>{r.transit_days ?? '—'}</td>
                    <td>{r.quote_number ?? '—'}</td>
                    <td className={styles.notesCell}>{r.error ?? ''}</td>
                  </tr>
                )
              })}
            </tbody>
            {(() => {
              const totals = rows.reduce(
                (acc, r) => {
                  const ffeCost = r.rate ? (parseFloat(r.rate.replace(/[$,]/g, '')) || 0) : 0
                  const p = calcPricing(r.winning_rate ?? r.rate, marginPct, minProfit, maxProfit)
                  return p
                    ? { ffeCost: acc.ffeCost + ffeCost, ffeCount: acc.ffeCount + (r.rate ? 1 : 0), winCost: acc.winCost + p.cost, sell: acc.sell + p.sellPrice, gp: acc.gp + p.gp, count: acc.count + 1 }
                    : acc
                },
                { ffeCost: 0, ffeCount: 0, winCost: 0, sell: 0, gp: 0, count: 0 }
              )
              if (!totals.count) return null
              return (
                <tfoot>
                  <tr className={styles.totalsRow}>
                    <td colSpan={7} className={styles.totalsLabel}>Totals — {totals.count} lane{totals.count !== 1 ? 's' : ''}</td>
                    <td className={styles.rateCell}>{totals.ffeCount > 0 ? fmtMoney(totals.ffeCost) : '—'}</td>
                    <td colSpan={2} />
                    <td className={styles.winnerCell}>{fmtMoney(totals.winCost)}</td>
                    <td colSpan={2} />
                    <td className={styles.sellCell}>{fmtMoney(totals.sell)}</td>
                    <td className={styles.gpCell}>{fmtMoney(totals.gp)}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              )
            })()}
          </table>
        </div>
      </div>
    </div>
  )
}

function PricingPanel({
  marginPct, minProfit, maxProfit, onMarginPct, onMinProfit, onMaxProfit, rows,
}: {
  marginPct: number; minProfit: number; maxProfit: number
  onMarginPct: (v: number) => void; onMinProfit: (v: number) => void; onMaxProfit: (v: number) => void
  rows: QuoteRow[]
}) {
  const totals = rows.reduce(
    (acc, r) => { const p = calcPricing(r.winning_rate ?? r.rate, marginPct, minProfit, maxProfit); return p ? { cost: acc.cost + p.cost, sell: acc.sell + p.sellPrice, gp: acc.gp + p.gp, count: acc.count + 1 } : acc },
    { cost: 0, sell: 0, gp: 0, count: 0 }
  )
  return (
    <div className={styles.pricingPanel}>
      <div className={styles.pricingHeader}>Pricing Controls</div>
      <div className={styles.pricingInputRow}>
        <div className={styles.pricingField}>
          <label className={styles.pricingLabel}>Margin %</label>
          <input className={styles.pricingInput} type="number" min={0} max={99} step={0.5}
            value={marginPct} onChange={(e) => onMarginPct(parseFloat(e.target.value) || 0)} />
        </div>
        <div className={styles.pricingField}>
          <label className={styles.pricingLabel}>Min Profit ($)</label>
          <input className={styles.pricingInput} type="number" min={0} step={1}
            value={minProfit} onChange={(e) => onMinProfit(parseFloat(e.target.value) || 0)} />
        </div>
        <div className={styles.pricingField}>
          <label className={styles.pricingLabel}>Max Profit ($)</label>
          <input className={styles.pricingInput} type="number" min={0} step={1}
            value={maxProfit} onChange={(e) => onMaxProfit(parseFloat(e.target.value) || 0)} />
        </div>
      </div>
      {totals.count > 0 && (
        <div className={styles.gpSummaryBar}>
          <div className={styles.gpStat}>
            <span className={styles.gpStatNum}>{totals.count}</span>
            <span className={styles.gpStatLbl}>Lanes Quoted</span>
          </div>
          <div className={styles.gpDivider} />
          <div className={styles.gpStat}>
            <span className={styles.gpStatNum}>{fmtMoney(totals.cost)}</span>
            <span className={styles.gpStatLbl}>Total Buy Cost</span>
          </div>
          <div className={styles.gpDivider} />
          <div className={styles.gpStat}>
            <span className={styles.gpStatNum}>{fmtMoney(totals.sell)}</span>
            <span className={styles.gpStatLbl}>Total Sell Price</span>
          </div>
          <div className={styles.gpDivider} />
          <div className={`${styles.gpStat} ${styles.gpStatHighlight}`}>
            <span className={styles.gpStatNum}>{fmtMoney(totals.gp)}</span>
            <span className={styles.gpStatLbl}>Total GP</span>
          </div>
        </div>
      )}
    </div>
  )
}
