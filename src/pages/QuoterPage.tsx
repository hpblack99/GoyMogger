import { useState, useCallback, useRef } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import styles from './QuoterPage.module.css'

// ── FFE dropdown options (exact labels from ffeinc.com /Customer/RateRequest) ──
const CLASS_OPTIONS = [
  '55', '60', '65', '70', '77.5', '85', '92.5', '100',
  '110', '125', '150', '175', '200', '250', '300', '400', '500',
]

const COMMODITY_OPTIONS = [
  'Animal Food - Not for Human Consumption',
  'Bakery Goods Less Than 12 Pounds Per Cubic Foot',
  'Bakery Goods Over 12 Pounds Per Cubic Foot',
  'Candy and Confectionery Less Than 12 Pounds Per Cubic Foot',
  'Candy and Confectionery Over 12 Pounds Per Cubic Foot',
  'Dairy Products Over 12 Pounds Per Cubic Foot',
  'Dairy Products Less Than 12 Pound Per Cubic Foot',
  'Drugs, Medicines, or Toilet Preparations',
  'Foodstuffs Less Than 12 Pounds Per Cubic Foot',
  'Foodstuffs Over 12 Pounds Per Cubic Foot',
  'Juices, Fruit, Vegetables',
  'Lard, Shortening & Cooking Oils',
  'Liquors and Alcoholic Beverages, Not Exceeding 6% By Volume',
  'Liquors and Wine',
  'Meats & Meat Products',
  'Medicine or Medical Supplies',
  'Nuts Edible',
  'Pasta Products',
  'Seafood',
  'Wax Products or Candles',
]

// ── Types ──────────────────────────────────────────────────────────────────────
interface ShipmentRow {
  origin_zip: string
  dest_zip: string
  weight: number
  freight_class?: string
  pieces?: number
  commodity?: string
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
  status: 'pending' | 'processing' | 'complete' | 'error'
  rate?: string
  transit_days?: string
  quote_number?: string
  error?: string
}

interface QuoteJob {
  id: string
  status: 'pending' | 'running' | 'complete' | 'error'
  total_rows: number
  done_rows: number
  error?: string
  created_at: string
}

type Step = 'upload' | 'preview' | 'waiting' | 'running' | 'done'

// ── Column detection patterns ──────────────────────────────────────────────────
const COL_PATTERNS: Record<string, RegExp> = {
  origin_zip:    /origin|orig|shipper.?zip/i,
  dest_zip:      /dest|destination|consignee.?zip/i,
  weight:        /weight|wt\b/i,
  freight_class: /class|nmfc/i,
  pieces:        /piece|pallet|qty/i,
  commodity:     /commodity|description|desc\b/i,
}

function parseXlsx(file: File): Promise<ShipmentRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target!.result, { type: 'binary' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1 })
        if (raw.length < 2) { reject(new Error('File needs a header row and at least one data row.')); return }

        const headers = (raw[0] as string[]).map((h) => String(h ?? '').trim())
        const colIdx: Partial<Record<string, number>> = {}
        for (const [key, pat] of Object.entries(COL_PATTERNS)) {
          const idx = headers.findIndex((h) => pat.test(h))
          if (idx >= 0) colIdx[key] = idx
        }

        // origin, dest, weight are always required
        const required = ['origin_zip', 'dest_zip', 'weight'] as const
        const missing = required.filter((k) => colIdx[k] === undefined)
        if (missing.length) {
          reject(new Error(`Missing columns: ${missing.join(', ')}.\nHeaders found: ${headers.join(', ')}`))
          return
        }

        const rows: ShipmentRow[] = raw
          .slice(1)
          .filter((r) => Array.isArray(r) && r.length && r[colIdx.origin_zip!])
          .map((r) => ({
            origin_zip:    String(r[colIdx.origin_zip!] ?? '').trim(),
            dest_zip:      String(r[colIdx.dest_zip!] ?? '').trim(),
            weight:        Number(r[colIdx.weight!] ?? 0),
            freight_class: colIdx.freight_class !== undefined ? String(r[colIdx.freight_class] ?? '').trim() || undefined : undefined,
            pieces:        colIdx.pieces !== undefined ? Number(r[colIdx.pieces]) || undefined : undefined,
            commodity:     colIdx.commodity !== undefined ? String(r[colIdx.commodity] ?? '').trim() || undefined : undefined,
          }))

        resolve(rows)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('File read error'))
    reader.readAsBinaryString(file)
  })
}

function downloadResults(rows: QuoteRow[]) {
  const data = rows.map((r) => ({
    '#':            r.row_index,
    'Origin ZIP':   r.origin_zip,
    'Dest ZIP':     r.dest_zip,
    'Weight (lbs)': r.weight,
    'Class':        r.freight_class,
    'Pieces':       r.pieces ?? '',
    'Commodity':    r.commodity ?? '',
    'Rate':         r.rate ?? '',
    'Transit Days': r.transit_days ?? '',
    'Quote #':      r.quote_number ?? '',
    'Status':       r.status,
    'Notes':        r.error ?? '',
  }))
  const ws = XLSX.utils.json_to_sheet(data)
  ws['!cols'] = [4,12,12,14,8,8,20,12,14,14,10,30].map((w) => ({ wch: w }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'FFE Quotes')
  XLSX.writeFile(wb, `ffe-quotes-${new Date().toISOString().split('T')[0]}.xlsx`)
}

function StatusBadge({ status }: { status: QuoteRow['status'] }) {
  const map = {
    pending:    { label: 'Pending',       cls: styles.statusPending },
    processing: { label: 'Processing…',   cls: styles.statusProcessing },
    complete:   { label: 'Complete',      cls: styles.statusComplete },
    error:      { label: 'Error',         cls: styles.statusError },
  }
  const { label, cls } = map[status]
  return <span className={`${styles.badge} ${cls}`}>{label}</span>
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function QuoterPage() {
  const [step, setStep]                 = useState<Step>('upload')
  const [parsedRows, setParsedRows]     = useState<ShipmentRow[]>([])
  const [job, setJob]                   = useState<QuoteJob | null>(null)
  const [quoteRows, setQuoteRows]       = useState<QuoteRow[]>([])
  const [uploadError, setUploadError]   = useState<string | null>(null)
  const [submitError, setSubmitError]   = useState<string | null>(null)
  const [isDragging, setIsDragging]     = useState(false)
  const [uploading, setUploading]       = useState(false)
  const [globalClass, setGlobalClass]   = useState('')
  const [globalCommodity, setGlobalCommodity] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const channelRef   = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // Commodity takes priority; class second; spreadsheet value last
  const effectiveFreightClass = (r: ShipmentRow): string => {
    if (globalCommodity) return globalCommodity
    if (globalClass)     return `Class ${globalClass}`
    return r.freight_class ?? ''
  }

  // ── Handle file drop/select ──────────────────────────────────────────────────
  const handleFile = useCallback(async (file: File) => {
    setUploadError(null)
    setUploading(true)
    try {
      const rows = await parseXlsx(file)
      if (!rows.length) throw new Error('No valid data rows found.')
      setParsedRows(rows)
      setStep('preview')
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to parse file')
    } finally {
      setUploading(false)
    }
  }, [])

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
    e.target.value = ''
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  // ── Submit job to Supabase ───────────────────────────────────────────────────
  const submitJob = async () => {
    setSubmitError(null)

    // Validate every row has a class (from UI or spreadsheet)
    const missingClass = parsedRows.some((r) => !effectiveFreightClass(r))
    if (missingClass) {
      setSubmitError(
        'No freight class set. Either select a Class or Commodity Type above, ' +
        'or include a "Class" column in your spreadsheet.'
      )
      return
    }

    try {
      const { data: jobData, error: jobErr } = await supabase
        .from('quote_jobs')
        .insert({ total_rows: parsedRows.length, status: 'pending' })
        .select()
        .single()

      if (jobErr) throw jobErr

      const rowInserts = parsedRows.map((r, i) => ({
        job_id:        jobData.id,
        row_index:     i + 1,
        origin_zip:    r.origin_zip,
        dest_zip:      r.dest_zip,
        weight:        r.weight,
        freight_class: effectiveFreightClass(r),
        pieces:        r.pieces ?? undefined,
        commodity:     globalCommodity || r.commodity || undefined,
        status:        'pending',
      }))

      const { error: rowsErr } = await supabase.from('quote_rows').insert(rowInserts)
      if (rowsErr) throw rowsErr

      setJob(jobData as QuoteJob)
      setQuoteRows(rowInserts.map((r, i) => ({ ...r, id: '', status: 'pending' as const, row_index: i + 1 })))
      setStep('waiting')
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to submit job')
    }
  }

  // ── Subscribe to real-time updates once we have a job ───────────────────────
  const subscribeToJob = (jobId: string) => {
    supabase
      .from('quote_rows')
      .select('*')
      .eq('job_id', jobId)
      .order('row_index')
      .then(({ data }) => { if (data) setQuoteRows(data as QuoteRow[]) })

    const channel = supabase
      .channel(`job-${jobId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'quote_jobs', filter: `id=eq.${jobId}` },
        (payload) => {
          const updated = payload.new as QuoteJob
          setJob(updated)
          if (updated.status === 'complete' || updated.status === 'error') setStep('done')
          else if (updated.status === 'running') setStep('running')
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'quote_rows', filter: `job_id=eq.${jobId}` },
        (payload) => {
          const updated = payload.new as QuoteRow
          setQuoteRows((prev) =>
            prev.map((r) => (r.id === updated.id || r.row_index === updated.row_index ? updated : r))
          )
          setStep((s) => s === 'waiting' ? 'running' : s)
        }
      )
      .subscribe()

    channelRef.current = channel
  }

  // Subscribe when job is created
  const prevJobId = useRef<string | null>(null)
  if (job?.id && job.id !== prevJobId.current && (step === 'waiting' || step === 'running')) {
    prevJobId.current = job.id
    subscribeToJob(job.id)
  }

  // ── Reset ────────────────────────────────────────────────────────────────────
  const reset = () => {
    if (channelRef.current) supabase.removeChannel(channelRef.current)
    prevJobId.current = null
    setStep('upload')
    setParsedRows([])
    setJob(null)
    setQuoteRows([])
    setUploadError(null)
    setSubmitError(null)
  }

  const pct       = job ? Math.round((job.done_rows / job.total_rows) * 100) : 0
  const completed = quoteRows.filter((r) => r.status === 'complete').length
  const errors    = quoteRows.filter((r) => r.status === 'error').length

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>FFE Reefer LTL Quote Bot</h1>
        <p className={styles.subtitle}>
          Upload a spreadsheet → job lands in Supabase → Python worker quotes each row → results appear live.
        </p>
        <StepIndicator current={step} />
      </div>

      {/* ── STEP 1: Upload ── */}
      {step === 'upload' && (
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Step 1 — Upload Shipment Spreadsheet</h2>

          {/* Batch settings */}
          <div className={styles.batchSettings}>
            <p className={styles.batchLabel}>Apply to all rows</p>
            <div className={styles.settingsGrid}>
              <label className={styles.label}>
                Freight Class
                <select
                  className={styles.select}
                  value={globalClass}
                  onChange={(e) => { setGlobalClass(e.target.value); if (e.target.value) setGlobalCommodity('') }}
                >
                  <option value="">— use spreadsheet column —</option>
                  {CLASS_OPTIONS.map((c) => (
                    <option key={c} value={c}>Class {c}</option>
                  ))}
                </select>
              </label>
              <label className={styles.label}>
                Commodity Type <span className={styles.labelMeta}>(overrides Class)</span>
                <select
                  className={styles.select}
                  value={globalCommodity}
                  onChange={(e) => { setGlobalCommodity(e.target.value); if (e.target.value) setGlobalClass('') }}
                >
                  <option value="">— use spreadsheet column —</option>
                  {COMMODITY_OPTIONS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className={styles.divider} />

          <p className={styles.hint}>
            Formats: <strong>.csv</strong>, <strong>.xlsx</strong>, <strong>.xls</strong><br />
            Required columns: <code>Origin ZIP</code> · <code>Dest ZIP</code> · <code>Weight</code><br />
            Optional columns: <code>Class</code> · <code>Pieces</code> · <code>Commodity</code>
            {!globalClass && !globalCommodity && <> — <em>or select above to skip</em></>}
          </p>
          <div
            className={`${styles.dropzone} ${isDragging ? styles.dragging : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
          >
            {uploading
              ? <span className={styles.spinner} />
              : <>
                  <span className={styles.dropIcon}>📂</span>
                  <span className={styles.dropText}>
                    {isDragging ? 'Drop it!' : 'Drag & drop your spreadsheet here, or click to browse'}
                  </span>
                </>}
          </div>
          <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={onFileInput} />
          {uploadError && <p className={styles.errorMsg}>{uploadError}</p>}
        </div>
      )}

      {/* ── STEP 2: Preview ── */}
      {step === 'preview' && (
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Step 2 — Review &amp; Submit</h2>

          {(globalCommodity || globalClass) && (
            <div className={styles.batchBadge}>
              Applying to all rows:{' '}
              <strong>{globalCommodity || `Class ${globalClass}`}</strong>
            </div>
          )}

          <p className={styles.hint}>
            {parsedRows.length} shipment{parsedRows.length !== 1 ? 's' : ''} parsed.
            Submitting creates the job in Supabase — make sure your Python worker is running.
          </p>
          <ShipmentPreviewTable rows={parsedRows} effectiveClass={effectiveFreightClass} />
          {submitError && <p className={styles.errorMsg}>{submitError}</p>}
          <div className={styles.actions}>
            <button className={styles.btnSecondary} onClick={() => setStep('upload')}>Back</button>
            <button className={styles.btnPrimary} onClick={submitJob}>
              Submit {parsedRows.length} Shipment{parsedRows.length !== 1 ? 's' : ''} to Queue
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Waiting for worker ── */}
      {step === 'waiting' && (
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Waiting for Worker…</h2>
          <p className={styles.hint}>
            Job <code className={styles.jobId}>{job?.id}</code> is in the queue.<br />
            Start your Python worker if it's not already running:
          </p>
          <pre className={styles.codeBlock}>cd python && python worker.py</pre>
          <p className={styles.hint}>The page will update automatically once the worker picks it up.</p>
          <div className={styles.waitSpinnerRow}>
            <span className={styles.spinner} />
          </div>
        </div>
      )}

      {/* ── STEP 4: Running ── */}
      {step === 'running' && job && (
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Quoting in Progress…</h2>
          <ProgressBar pct={pct} done={job.done_rows} total={job.total_rows} />
          <ResultsTable rows={quoteRows} />
        </div>
      )}

      {/* ── STEP 5: Done ── */}
      {step === 'done' && job && (
        <div className={styles.card}>
          {job.status === 'error'
            ? <>
                <h2 className={`${styles.cardTitle} ${styles.errorTitle}`}>Worker Error</h2>
                <p className={styles.errorMsg}>{job.error}</p>
                <p className={styles.hint}>Check <code>python/screenshots/</code> for debug screenshots.<br />Most fixes are in <code>python/ffe-selectors.json</code>.</p>
              </>
            : <>
                <h2 className={styles.cardTitle}>Done!</h2>
                <div className={styles.summaryRow}>
                  <div className={styles.summaryChip}><span className={styles.summaryNum}>{completed}</span> Quoted</div>
                  {errors > 0 && <div className={`${styles.summaryChip} ${styles.summaryChipError}`}><span className={styles.summaryNum}>{errors}</span> Errors</div>}
                </div>
              </>}
          <ResultsTable rows={quoteRows} />
          <div className={styles.actions}>
            {quoteRows.length > 0 && (
              <button className={styles.btnPrimary} onClick={() => downloadResults(quoteRows)}>
                Download Results (.xlsx)
              </button>
            )}
            <button className={styles.btnSecondary} onClick={reset}>Start Over</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: 'upload',  label: 'Upload'  },
    { key: 'preview', label: 'Preview' },
    { key: 'waiting', label: 'Queued'  },
    { key: 'running', label: 'Running' },
    { key: 'done',    label: 'Done'    },
  ]
  const idx = steps.findIndex((s) => s.key === current)
  return (
    <div className={styles.steps}>
      {steps.map((s, i) => (
        <div key={s.key} className={`${styles.step} ${i < idx ? styles.stepDone : ''} ${i === idx ? styles.stepActive : ''}`}>
          <div className={styles.stepDot}>{i < idx ? '✓' : i + 1}</div>
          <span className={styles.stepLabel}>{s.label}</span>
        </div>
      ))}
    </div>
  )
}

function ProgressBar({ pct, done, total }: { pct: number; done: number; total: number }) {
  return (
    <div className={styles.progressSection}>
      <div className={styles.progressBar}>
        <div className={styles.progressFill} style={{ width: `${pct}%` }} />
      </div>
      <p className={styles.progressLabel}>{done} / {total} ({pct}%)</p>
    </div>
  )
}

function ShipmentPreviewTable({
  rows,
  effectiveClass,
}: {
  rows: ShipmentRow[]
  effectiveClass: (r: ShipmentRow) => string
}) {
  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr><th>#</th><th>Origin ZIP</th><th>Dest ZIP</th><th>Weight</th><th>Class / Commodity</th><th>Pieces</th></tr>
        </thead>
        <tbody>
          {rows.slice(0, 50).map((r, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>{r.origin_zip}</td>
              <td>{r.dest_zip}</td>
              <td>{r.weight}</td>
              <td>{effectiveClass(r) || <span className={styles.noClass}>not set</span>}</td>
              <td>{r.pieces ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 50 && <p className={styles.truncNote}>Showing first 50 of {rows.length} rows.</p>}
    </div>
  )
}

function ResultsTable({ rows }: { rows: QuoteRow[] }) {
  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr><th>#</th><th>Origin</th><th>Dest</th><th>Weight</th><th>Class / Commodity</th><th>Status</th><th>Rate</th><th>Transit</th><th>Quote #</th><th>Notes</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id || r.row_index} className={r.status === 'error' ? styles.rowError : r.status === 'complete' ? styles.rowComplete : ''}>
              <td>{r.row_index}</td>
              <td>{r.origin_zip}</td>
              <td>{r.dest_zip}</td>
              <td>{r.weight}</td>
              <td>{r.freight_class}</td>
              <td><StatusBadge status={r.status} /></td>
              <td className={styles.rateCell}>{r.rate ?? '—'}</td>
              <td>{r.transit_days ?? '—'}</td>
              <td>{r.quote_number ?? '—'}</td>
              <td className={styles.notesCell}>{r.error ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
