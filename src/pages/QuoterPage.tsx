import { useState, useEffect, useRef, useCallback } from 'react'
import styles from './QuoterPage.module.css'

// ── Types ──────────────────────────────────────────────────────────────────────
interface ShipmentRow {
  rowIndex: number
  originZip: string
  destZip: string
  weight: number
  freightClass: string
  pieces?: number
  commodity?: string
}

interface QuoteResult extends ShipmentRow {
  status: 'pending' | 'processing' | 'complete' | 'error'
  rate?: string
  transitDays?: string
  quoteNumber?: string
  error?: string
}

interface Job {
  id: string
  status: 'queued' | 'running' | 'complete' | 'error'
  progress: number
  total: number
  results: QuoteResult[]
  error?: string
  createdAt: string
  completedAt?: string
}

type Step = 'upload' | 'credentials' | 'preview' | 'running' | 'done'

// ── Helpers ────────────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: QuoteResult['status'] }) {
  const map: Record<QuoteResult['status'], { label: string; cls: string }> = {
    pending: { label: 'Pending', cls: styles.statusPending },
    processing: { label: 'Processing…', cls: styles.statusProcessing },
    complete: { label: 'Complete', cls: styles.statusComplete },
    error: { label: 'Error', cls: styles.statusError },
  }
  const { label, cls } = map[status]
  return <span className={`${styles.badge} ${cls}`}>{label}</span>
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function QuoterPage() {
  const [step, setStep] = useState<Step>('upload')
  const [rows, setRows] = useState<ShipmentRow[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [debugMode, setDebugMode] = useState(false)
  const [job, setJob] = useState<Job | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Upload ──────────────────────────────────────────────────────────────────
  const handleFile = useCallback(async (file: File) => {
    setUploadError(null)
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setRows(data.rows)
      setStep('credentials')
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }, [])

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  // ── Run job ──────────────────────────────────────────────────────────────────
  const startJob = async () => {
    setRunError(null)
    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, username, password, debugMode }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to start job')
      setJob({ id: data.jobId, status: 'queued', progress: 0, total: rows.length, results: rows.map(r => ({ ...r, status: 'pending' })), createdAt: new Date().toISOString() })
      setStep('running')
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Failed to start')
    }
  }

  // ── Poll job status ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (step !== 'running' || !job?.id) return
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/job/${job.id}`)
        if (!res.ok) return
        const data: Job = await res.json()
        setJob(data)
        if (data.status === 'complete' || data.status === 'error') {
          clearInterval(pollRef.current!)
          setStep('done')
        }
      } catch { /* network glitch, keep polling */ }
    }, 2000)
    return () => clearInterval(pollRef.current!)
  }, [step, job?.id])

  // ── Download ─────────────────────────────────────────────────────────────────
  const download = () => {
    if (job?.id) window.location.href = `/api/download/${job.id}`
  }

  // ── Reset ────────────────────────────────────────────────────────────────────
  const reset = () => {
    setStep('upload')
    setRows([])
    setJob(null)
    setRunError(null)
    setUploadError(null)
  }

  // ── Render helpers ───────────────────────────────────────────────────────────
  const completedCount = job?.results.filter((r) => r.status === 'complete').length ?? 0
  const errorCount = job?.results.filter((r) => r.status === 'error').length ?? 0
  const pct = job ? Math.round((job.progress / job.total) * 100) : 0

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>FFE Reefer LTL Quote Bot</h1>
        <p className={styles.subtitle}>
          Upload a spreadsheet of shipments and automatically retrieve quotes from Frozen Food Express.
        </p>
        <StepIndicator current={step} />
      </div>

      {/* ── STEP 1: Upload ── */}
      {step === 'upload' && (
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Step 1 — Upload Shipment Spreadsheet</h2>
          <p className={styles.hint}>
            Accepted formats: <strong>.csv</strong>, <strong>.xlsx</strong>, <strong>.xls</strong>
            <br />
            Required columns: <code>Origin ZIP</code>, <code>Dest ZIP</code>, <code>Weight</code>, <code>Class</code>
            <br />
            Optional: <code>Pieces</code>, <code>Commodity</code>
          </p>
          <div
            className={`${styles.dropzone} ${isDragging ? styles.dragging : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
          >
            {uploading ? (
              <span className={styles.spinner} />
            ) : (
              <>
                <span className={styles.dropIcon}>📂</span>
                <span className={styles.dropText}>
                  {isDragging ? 'Drop it!' : 'Drag & drop your spreadsheet here, or click to browse'}
                </span>
              </>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            style={{ display: 'none' }}
            onChange={onFileInput}
          />
          {uploadError && <p className={styles.errorMsg}>{uploadError}</p>}
        </div>
      )}

      {/* ── STEP 2: Credentials ── */}
      {step === 'credentials' && (
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Step 2 — FFE Login Credentials</h2>
          <p className={styles.hint}>
            Your credentials are used only for this session and are never stored.
          </p>
          <div className={styles.form}>
            <label className={styles.label}>
              FFE Username
              <input
                className={styles.input}
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="your@email.com or username"
              />
            </label>
            <label className={styles.label}>
              FFE Password
              <input
                className={styles.input}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </label>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={debugMode}
                onChange={(e) => setDebugMode(e.target.checked)}
              />
              Debug mode (opens a visible browser window — useful for verifying form selectors)
            </label>
          </div>
          <div className={styles.actions}>
            <button className={styles.btnSecondary} onClick={() => setStep('upload')}>Back</button>
            <button
              className={styles.btnPrimary}
              disabled={!username || !password}
              onClick={() => setStep('preview')}
            >
              Next — Preview Shipments
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Preview ── */}
      {step === 'preview' && (
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Step 3 — Review &amp; Start</h2>
          <p className={styles.hint}>
            {rows.length} shipment{rows.length !== 1 ? 's' : ''} ready to quote.
          </p>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Origin ZIP</th>
                  <th>Dest ZIP</th>
                  <th>Weight</th>
                  <th>Class</th>
                  <th>Pieces</th>
                  <th>Commodity</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 50).map((r) => (
                  <tr key={r.rowIndex}>
                    <td>{r.rowIndex}</td>
                    <td>{r.originZip}</td>
                    <td>{r.destZip}</td>
                    <td>{r.weight}</td>
                    <td>{r.freightClass}</td>
                    <td>{r.pieces ?? '—'}</td>
                    <td>{r.commodity ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 50 && (
              <p className={styles.truncNote}>Showing first 50 of {rows.length} rows.</p>
            )}
          </div>
          {runError && <p className={styles.errorMsg}>{runError}</p>}
          <div className={styles.actions}>
            <button className={styles.btnSecondary} onClick={() => setStep('credentials')}>Back</button>
            <button className={styles.btnPrimary} onClick={startJob}>
              Start Quoting {rows.length} Shipment{rows.length !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 4: Running ── */}
      {step === 'running' && job && (
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Quoting in Progress…</h2>
          <div className={styles.progressSection}>
            <div className={styles.progressBar}>
              <div className={styles.progressFill} style={{ width: `${pct}%` }} />
            </div>
            <p className={styles.progressLabel}>
              {job.progress} / {job.total} ({pct}%)
            </p>
          </div>
          <ResultsTable results={job.results} />
        </div>
      )}

      {/* ── STEP 5: Done ── */}
      {step === 'done' && job && (
        <div className={styles.card}>
          {job.status === 'error' ? (
            <>
              <h2 className={`${styles.cardTitle} ${styles.errorTitle}`}>Job Failed</h2>
              <p className={styles.errorMsg}>{job.error}</p>
              <p className={styles.hint}>
                Check <code>server/screenshots/</code> for screenshots taken during automation.
                <br />
                Most issues are fixed by updating selectors in <code>server/ffe-selectors.json</code>.
              </p>
            </>
          ) : (
            <>
              <h2 className={styles.cardTitle}>Done!</h2>
              <div className={styles.summaryRow}>
                <div className={styles.summaryChip}>
                  <span className={styles.summaryNum}>{completedCount}</span> Quoted
                </div>
                {errorCount > 0 && (
                  <div className={`${styles.summaryChip} ${styles.summaryChipError}`}>
                    <span className={styles.summaryNum}>{errorCount}</span> Errors
                  </div>
                )}
              </div>
            </>
          )}
          <ResultsTable results={job.results} />
          <div className={styles.actions}>
            {job.status === 'complete' && (
              <button className={styles.btnPrimary} onClick={download}>
                Download Results (.xlsx)
              </button>
            )}
            <button className={styles.btnSecondary} onClick={reset}>
              Start Over
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function StepIndicator({ current }: { current: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: 'upload', label: 'Upload' },
    { key: 'credentials', label: 'Login' },
    { key: 'preview', label: 'Preview' },
    { key: 'running', label: 'Running' },
    { key: 'done', label: 'Done' },
  ]
  const currentIdx = steps.findIndex((s) => s.key === current)
  return (
    <div className={styles.steps}>
      {steps.map((s, i) => (
        <div
          key={s.key}
          className={`${styles.step} ${i < currentIdx ? styles.stepDone : ''} ${i === currentIdx ? styles.stepActive : ''}`}
        >
          <div className={styles.stepDot}>{i < currentIdx ? '✓' : i + 1}</div>
          <span className={styles.stepLabel}>{s.label}</span>
        </div>
      ))}
    </div>
  )
}

function ResultsTable({ results }: { results: QuoteResult[] }) {
  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>#</th>
            <th>Origin</th>
            <th>Dest</th>
            <th>Weight</th>
            <th>Class</th>
            <th>Status</th>
            <th>Rate</th>
            <th>Transit</th>
            <th>Quote #</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.rowIndex} className={r.status === 'error' ? styles.rowError : r.status === 'complete' ? styles.rowComplete : ''}>
              <td>{r.rowIndex}</td>
              <td>{r.originZip}</td>
              <td>{r.destZip}</td>
              <td>{r.weight}</td>
              <td>{r.freightClass}</td>
              <td><StatusBadge status={r.status} /></td>
              <td className={styles.rateCell}>{r.rate ?? '—'}</td>
              <td>{r.transitDays ?? '—'}</td>
              <td>{r.quoteNumber ?? '—'}</td>
              <td className={styles.notesCell}>{r.error ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
