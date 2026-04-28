import { useState, useEffect, useCallback, useRef } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import styles from './QuoterPage.module.css'

// ── FFE #Item1_ClassId options — exact labels from live DOM ───────────────────
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

const CLASS_OPTIONS = [
  '55', '60', '65', '70', '77.5', '85', '92.5', '100',
  '110', '125', '150', '175', '200', '250', '300', '400', '500',
]

// ── Types ──────────────────────────────────────────────────────────────────────
interface ShipmentRow {
  origin_zip: string
  dest_zip:   string
  weight:     number
}

interface QuoteRow {
  id:           string
  job_id:       string
  row_index:    number
  origin_zip:   string
  dest_zip:     string
  weight:       number
  freight_class: string
  status:       'pending' | 'processing' | 'complete' | 'error'
  rate?:        string
  transit_days?: string
  quote_number?: string
  error?:       string
}

interface QuoteJob {
  id:         string
  status:     'pending' | 'running' | 'complete' | 'error'
  total_rows: number
  done_rows:  number
  error?:     string
  created_at: string
}

type Step = 'upload' | 'preview' | 'waiting' | 'running' | 'done'

// ── Column detection — supports all common header variants ─────────────────────
const COL_PATTERNS: Record<string, RegExp> = {
  origin_zip: /origin|from.?zip|shipper.?zip/i,
  dest_zip:   /dest(?:ination)?|to.?zip|consignee/i,
  weight:     /(?:gross\s+|total\s+)?weight|^wt$/i,
}

function parseXlsx(file: File): Promise<ShipmentRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb  = XLSX.read(e.target!.result, { type: 'binary' })
        const ws  = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1 })
        if (raw.length < 2) { reject(new Error('File needs a header row and at least one data row.')); return }

        const headers = (raw[0] as string[]).map((h) => String(h ?? '').trim())
        const colIdx: Partial<Record<string, number>> = {}
        for (const [key, pat] of Object.entries(COL_PATTERNS)) {
          const idx = headers.findIndex((h) => pat.test(h))
          if (idx >= 0) colIdx[key] = idx
        }

        const missing = (['origin_zip', 'dest_zip', 'weight'] as const).filter((k) => colIdx[k] === undefined)
        if (missing.length) {
          reject(new Error(
            `Missing required columns: ${missing.join(', ')}.\n` +
            `Headers found: ${headers.join(', ')}`
          ))
          return
        }

        const rows: ShipmentRow[] = raw
          .slice(1)
          .filter((r) => Array.isArray(r) && r.length && r[colIdx.origin_zip!])
          .map((r) => ({
            origin_zip: String(r[colIdx.origin_zip!] ?? '').trim(),
            dest_zip:   String(r[colIdx.dest_zip!]   ?? '').trim(),
            weight:     Number(r[colIdx.weight!]      ?? 0),
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
    'Rate':         r.rate ?? '',
    'Transit Days': r.transit_days ?? '',
    'Quote #':      r.quote_number ?? '',
    'Status':       r.status,
    'Notes':        r.error ?? '',
  }))
  const ws = XLSX.utils.json_to_sheet(data)
  ws['!cols'] = [4, 12, 12, 14, 24, 12, 14, 14, 10, 30].map((w) => ({ wch: w }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'FFE Quotes')
  XLSX.writeFile(wb, `ffe-quotes-${new Date().toISOString().split('T')[0]}.xlsx`)
}

function StatusBadge({ status }: { status: QuoteRow['status'] }) {
  const map = {
    pending:    { label: 'Pending',     cls: styles.statusPending },
    processing: { label: 'Processing…', cls: styles.statusProcessing },
    complete:   { label: 'Complete',    cls: styles.statusComplete },
    error:      { label: 'Error',       cls: styles.statusError },
  }
  const { label, cls } = map[status]
  return <span className={`${styles.badge} ${cls}`}>{label}</span>
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function QuoterPage() {
  const [step, setStep]               = useState<Step>('upload')
  const [parsedRows, setParsedRows]   = useState<ShipmentRow[]>([])
  const [fileName, setFileName]       = useState<string | null>(null)
  const [job, setJob]                 = useState<QuoteJob | null>(null)
  const [quoteRows, setQuoteRows]     = useState<QuoteRow[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isDragging, setIsDragging]   = useState(false)
  const [uploading, setUploading]     = useState(false)
  const [freightClass, setFreightClass] = useState('')
  const [quoteName, setQuoteName]       = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const channelRef   = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // ── Handle file drop/select ──────────────────────────────────────────────────
  const handleFile = useCallback(async (file: File) => {
    setUploadError(null)
    setUploading(true)
    try {
      const rows = await parseXlsx(file)
      if (!rows.length) throw new Error('No valid data rows found.')
      setParsedRows(rows)
      setFileName(file.name)
      // Stay on upload step — user must also select a class before continuing
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
    if (!freightClass) {
      setSubmitError('Please select a Freight Class or Commodity Type before submitting.')
      return
    }
    try {
      const { data: jobData, error: jobErr } = await supabase
        .from('quote_jobs')
        .insert({ total_rows: parsedRows.length, status: 'pending', name: quoteName.trim() || null })
        .select()
        .single()
      if (jobErr) throw jobErr

      const rowInserts = parsedRows.map((r, i) => ({
        job_id:        jobData.id,
        row_index:     i + 1,
        origin_zip:    r.origin_zip,
        dest_zip:      r.dest_zip,
        weight:        r.weight,
        freight_class: freightClass,
        status:        'pending',
      }))

      const { error: rowsErr } = await supabase.from('quote_rows').insert(rowInserts)
      if (rowsErr) throw rowsErr

      setJob(jobData as QuoteJob)
      setQuoteRows(rowInserts.map((r) => ({ ...r, id: '', status: 'pending' as const })))
      setStep('waiting')
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to submit job')
    }
  }

  // ── Real-time subscription + polling fallback ────────────────────────────────
  useEffect(() => {
    if (!job?.id || step === 'upload' || step === 'preview' || step === 'done') return

    // Fetch current state immediately in case worker already finished
    supabase.from('quote_rows').select('*').eq('job_id', job.id).order('row_index')
      .then(({ data }) => { if (data) setQuoteRows(data as QuoteRow[]) })

    supabase.from('quote_jobs').select('*').eq('id', job.id).single()
      .then(({ data }) => {
        if (!data) return
        setJob(data as QuoteJob)
        if (data.status === 'complete' || data.status === 'error') setStep('done')
        else if (data.status === 'running') setStep('running')
      })

    // Realtime channel
    const channel = supabase
      .channel(`job-${job.id}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'quote_jobs', filter: `id=eq.${job.id}` },
        (payload) => {
          const u = payload.new as QuoteJob
          setJob(u)
          if (u.status === 'complete' || u.status === 'error') setStep('done')
          else if (u.status === 'running') setStep('running')
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'quote_rows', filter: `job_id=eq.${job.id}` },
        (payload) => {
          const u = payload.new as QuoteRow
          setQuoteRows((prev) => prev.map((r) => (r.id === u.id || r.row_index === u.row_index ? u : r)))
          setStep((s) => s === 'waiting' ? 'running' : s)
        })
      .subscribe()

    channelRef.current = channel

    // Polling fallback — catches updates if realtime delivery lags
    const poll = setInterval(async () => {
      const { data: jobData } = await supabase.from('quote_jobs').select('*').eq('id', job.id).single()
      if (!jobData) return
      setJob(jobData as QuoteJob)
      if (jobData.status === 'complete' || jobData.status === 'error') {
        const { data: rowData } = await supabase.from('quote_rows').select('*').eq('job_id', job.id).order('row_index')
        if (rowData) setQuoteRows(rowData as QuoteRow[])
        setStep('done')
        clearInterval(poll)
      } else if (jobData.status === 'running') {
        setStep('running')
      }
    }, 3000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(poll)
    }
  }, [job?.id, step === 'upload' || step === 'preview']) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reset ────────────────────────────────────────────────────────────────────
  const reset = () => {
    if (channelRef.current) supabase.removeChannel(channelRef.current)
    setStep('upload')
    setParsedRows([])
    setFileName(null)
    setJob(null)
    setQuoteRows([])
    setUploadError(null)
    setSubmitError(null)
    setQuoteName('')
  }

  const hasClass = freightClass !== ''
  const hasFile  = parsedRows.length > 0
  const canContinue = hasClass && hasFile

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
          <h2 className={styles.cardTitle}>Step 1 — Set Up Your Batch</h2>

          <div className={styles.nameField}>
            <label className={styles.classLabel}>Quote Name / Company</label>
            <input
              type="text"
              className={styles.input}
              placeholder="e.g. Acme Foods — April batch"
              value={quoteName}
              onChange={(e) => setQuoteName(e.target.value)}
              maxLength={120}
            />
          </div>
          <div className={styles.divider} />

          {/* ── 1a: Class selector ── */}
          <div className={`${styles.checkRow} ${hasClass ? styles.checkRowDone : ''}`}>
            <div className={styles.checkIcon}>{hasClass ? '✓' : '1'}</div>
            <div className={styles.checkBody}>
              <label className={styles.classLabel}>
                Freight Class / Commodity Type
              </label>
              <p className={styles.classHint}>Applies to every shipment in this batch.</p>
              <select
                className={`${styles.select} ${!hasClass ? styles.selectEmpty : ''}`}
                value={freightClass}
                onChange={(e) => setFreightClass(e.target.value)}
              >
                <option value="">— Select class or commodity —</option>
                <optgroup label="Commodity Type">
                  {COMMODITY_OPTIONS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </optgroup>
                <optgroup label="Freight Class">
                  {CLASS_OPTIONS.map((c) => (
                    <option key={c} value={`Class ${c}`}>Class {c}</option>
                  ))}
                </optgroup>
              </select>
            </div>
          </div>

          <div className={styles.divider} />

          {/* ── 1b: File upload ── */}
          <div className={`${styles.checkRow} ${hasFile ? styles.checkRowDone : ''}`}>
            <div className={styles.checkIcon}>{hasFile ? '✓' : '2'}</div>
            <div className={styles.checkBody}>
              <p className={styles.classLabel}>Shipment Spreadsheet</p>
              <p className={styles.classHint}>
                Required columns: <code>Origin ZIP</code> · <code>Dest ZIP</code> · <code>Weight</code><br />
                <span className={styles.colAliasInline}>Also: From Zip, To Zip, Gross Weight, etc.</span>
              </p>

              {hasFile ? (
                <div className={styles.fileConfirm}>
                  <span className={styles.fileIcon}>📄</span>
                  <span className={styles.fileName}>{fileName}</span>
                  <span className={styles.fileCount}>{parsedRows.length} row{parsedRows.length !== 1 ? 's' : ''}</span>
                  <button
                    className={styles.changeFile}
                    onClick={() => { setParsedRows([]); setFileName(null); setUploadError(null); fileInputRef.current?.click() }}
                  >
                    Change
                  </button>
                </div>
              ) : (
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
                          {isDragging ? 'Drop it!' : 'Drag & drop .csv / .xlsx / .xls, or click to browse'}
                        </span>
                      </>}
                </div>
              )}

              <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={onFileInput} />
              {uploadError && <p className={styles.errorMsg}>{uploadError}</p>}
            </div>
          </div>

          <div className={styles.divider} />

          <div className={styles.actions}>
            <button
              className={styles.btnPrimary}
              disabled={!canContinue}
              onClick={() => setStep('preview')}
            >
              Continue to Preview →
            </button>
            {!canContinue && (
              <span className={styles.continueHint}>
                {!hasClass && !hasFile ? 'Select a class and upload a file to continue'
                  : !hasClass ? 'Select a freight class or commodity to continue'
                  : 'Upload a spreadsheet to continue'}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── STEP 2: Preview ── */}
      {step === 'preview' && (
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Step 2 — Review &amp; Submit</h2>
          <div className={styles.batchBadge}>
            Applying to all rows: <strong>{freightClass}</strong>
          </div>
          <p className={styles.hint}>
            {parsedRows.length} shipment{parsedRows.length !== 1 ? 's' : ''} parsed. Make sure your Python worker is running before submitting.
          </p>
          <ShipmentPreviewTable rows={parsedRows} />
          {submitError && <p className={styles.errorMsg}>{submitError}</p>}
          <div className={styles.actions}>
            <button className={styles.btnSecondary} onClick={() => setStep('upload')}>Back</button>
            <button className={styles.btnPrimary} onClick={submitJob}>
              Submit {parsedRows.length} Shipment{parsedRows.length !== 1 ? 's' : ''} to Queue
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Waiting ── */}
      {step === 'waiting' && (
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Waiting for Worker…</h2>
          <p className={styles.hint}>
            Job <code className={styles.jobId}>{job?.id}</code> is in the queue.<br />
            Start your Python worker if it's not running:
          </p>
          <pre className={styles.codeBlock}>cd python && python worker.py</pre>
          <p className={styles.hint}>The page will update automatically once the worker picks it up.</p>
          <div className={styles.waitSpinnerRow}><span className={styles.spinner} /></div>
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
                <p className={styles.hint}>Check <code>python/screenshots/</code> for debug screenshots.</p>
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

function ShipmentPreviewTable({ rows }: { rows: ShipmentRow[] }) {
  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr><th>#</th><th>Origin ZIP</th><th>Dest ZIP</th><th>Weight (lbs)</th></tr>
        </thead>
        <tbody>
          {rows.slice(0, 50).map((r, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>{r.origin_zip}</td>
              <td>{r.dest_zip}</td>
              <td>{r.weight}</td>
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
          <tr><th>#</th><th>Origin</th><th>Dest</th><th>Weight</th><th>Status</th><th>Rate</th><th>Transit</th><th>Quote #</th><th>Notes</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id || r.row_index} className={r.status === 'error' ? styles.rowError : r.status === 'complete' ? styles.rowComplete : ''}>
              <td>{r.row_index}</td>
              <td>{r.origin_zip}</td>
              <td>{r.dest_zip}</td>
              <td>{r.weight}</td>
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
