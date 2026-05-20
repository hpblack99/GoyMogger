import { useState, useEffect, useCallback, useRef } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { ACCESSORIALS } from '../lib/accessorials'
import { FRESHX_TEMPERATURES, FRESHX_COMMODITIES } from '../lib/freshx'
import styles from './QuoterPage.module.css'

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

// ── Types ─────────────────────────────────────────────────────────────────────────────
interface ShipmentRow {
  origin_zip: string
  dest_zip:   string
  weight:     number
  pallets?:   number
}

interface QuoteRow {
  id:              string
  job_id:          string
  row_index:       number
  origin_zip:      string
  dest_zip:        string
  weight:          number
  freight_class:   string
  pallets?:        number
  status:          'pending' | 'processing' | 'complete' | 'error'
  rate?:           string
  transit_days?:   string
  quote_number?:   string
  error?:          string
  freshx_rate?:    string
  freshx_carrier?: string
  winning_rate?:    string
  winning_carrier?: string
  winning_source?:  string
}

interface QuoteJob {
  id:            string
  status:        'pending' | 'running' | 'complete' | 'error'
  total_rows:    number
  done_rows:     number
  error?:        string
  created_at:    string
  temperature?:  string
  commodity?:    string
  is_stackable?: boolean
}

type Step = 'upload' | 'preview' | 'waiting' | 'running' | 'done'

// ── Column detection ─────────────────────────────────────────────────────────────
const COL_PATTERNS: Record<string, RegExp> = {
  origin_zip: /origin|from.?zip|shipper.?zip/i,
  dest_zip:   /dest(?:ination)?|to.?zip|consignee/i,
  weight:     /(?:gross\s+|total\s+)?weight|^wt$/i,
  pallets:    /pallets?/i,
}

function padZip(z: string): string {
  const t = z.trim()
  return /^\d+$/.test(t) ? t.padStart(5, '0') : t
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
          .map((r) => {
            const palletRaw = colIdx.pallets !== undefined ? r[colIdx.pallets] : undefined
            const pallets = palletRaw !== undefined ? (parseInt(String(palletRaw), 10) || undefined) : undefined
            return {
              origin_zip: padZip(String(r[colIdx.origin_zip!] ?? '')),
              dest_zip:   padZip(String(r[colIdx.dest_zip!]   ?? '')),
              weight:     Number(r[colIdx.weight!] ?? 0),
              pallets,
            }
          })

        resolve(rows)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('File read error'))
    reader.readAsBinaryString(file)
  })
}

function downloadResults(rows: QuoteRow[], companyName: string, marginPct: number, minProfit: number, maxProfit: number) {
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
  ws['!cols'] = [4,12,12,14,8,10,14,14,18,14,18,8,14,12,12,14,14,10,30].map((w) => ({ wch: w }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Reefer Quotes')
  const safe = (companyName.trim() || 'Quotes').replace(/[\/\\?%*:|"<>]/g, '-')
  XLSX.writeFile(wb, `${safe} Reefer Quotes.xlsx`)
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

// ── Main component ────────────────────────────────────────────────────────────────
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
  const [freightClass, setFreightClass]                 = useState('')
  const [quoteName, setQuoteName]                       = useState('')
  const [selectedAccessorials, setSelectedAccessorials] = useState<Set<string>>(new Set())
  const [temperature, setTemperature]   = useState('')
  const [commodity, setCommodity]       = useState('')
  const [isStackable, setIsStackable]   = useState(false)
  const [marginPct,  setMarginPct]      = useState(15)
  const [minProfit,  setMinProfit]      = useState(75)
  const [maxProfit,  setMaxProfit]      = useState(500)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const channelRef   = useRef<ReturnType<typeof supabase.channel> | null>(null)

  const toggleAccessorial = (key: string) => {
    setSelectedAccessorials((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const handleFile = useCallback(async (file: File) => {
    setUploadError(null)
    setUploading(true)
    try {
      const rows = await parseXlsx(file)
      if (!rows.length) throw new Error('No valid data rows found.')
      setParsedRows(rows)
      setFileName(file.name)
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

  // ── Submit job ────────────────────────────────────────────────────────────
  const submitJob = async () => {
    setSubmitError(null)
    if (!freightClass) {
      setSubmitError('Please select a Freight Class or Commodity Type before submitting.')
      return
    }
    try {
      const jobPayload: Record<string, unknown> = {
        total_rows:   parsedRows.length,
        status:       'pending',
        name:         quoteName.trim() || null,
        accessorials: Array.from(selectedAccessorials),
        temperature:  temperature || null,
        commodity:    commodity || null,
        is_stackable: isStackable,
      }

      let { data: jobData, error: jobErr } = await supabase
        .from('quote_jobs').insert(jobPayload).select().single()

      if (jobErr?.message && /temperature|commodity|is_stackable/i.test(jobErr.message)) {
        delete jobPayload.temperature; delete jobPayload.commodity; delete jobPayload.is_stackable
        const r = await supabase.from('quote_jobs').insert(jobPayload).select().single()
        jobData = r.data; jobErr = r.error
      }
      if (jobErr?.message?.includes('name')) {
        delete jobPayload.name
        const r = await supabase.from('quote_jobs').insert(jobPayload).select().single()
        jobData = r.data; jobErr = r.error
      }
      if (jobErr?.message?.includes('accessorials')) {
        delete jobPayload.accessorials
        const r = await supabase.from('quote_jobs').insert(jobPayload).select().single()
        jobData = r.data; jobErr = r.error
      }
      if (jobErr) throw jobErr

      const rowInserts = parsedRows.map((r, i) => ({
        job_id:        jobData!.id,
        row_index:     i + 1,
        origin_zip:    r.origin_zip,
        dest_zip:      r.dest_zip,
        weight:        r.weight,
        pallets:       r.pallets ?? null,
        freight_class: freightClass,
        status:        'pending',
      }))

      let { error: rowsErr } = await supabase.from('quote_rows').insert(rowInserts)
      if (rowsErr?.message?.toLowerCase().includes('pallets')) {
        const withoutPallets = rowInserts.map((r) => ({
          job_id: r.job_id, row_index: r.row_index, origin_zip: r.origin_zip,
          dest_zip: r.dest_zip, weight: r.weight, freight_class: r.freight_class, status: r.status,
        }))
        const retry = await supabase.from('quote_rows').insert(withoutPallets)
        rowsErr = retry.error
      }
      if (rowsErr) throw rowsErr

      setJob(jobData as QuoteJob)
      setQuoteRows(rowInserts.map((r) => ({ ...r, id: '', status: 'pending' as const, pallets: r.pallets ?? undefined })))
      setStep('waiting')
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? String(err)
      setSubmitError(msg || 'Failed to submit bid')
    }
  }

  // ── Realtime + polling ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!job?.id || step === 'upload' || step === 'preview' || step === 'done') return

    supabase.from('quote_rows').select('*').eq('job_id', job.id).order('row_index')
      .then(({ data }) => { if (data) setQuoteRows(data as QuoteRow[]) })

    supabase.from('quote_jobs').select('*').eq('id', job.id).single()
      .then(({ data }) => {
        if (!data) return
        setJob(data as QuoteJob)
        if (data.status === 'complete' || data.status === 'error') setStep('done')
        else if (data.status === 'running') setStep('running')
      })

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
        const { data: rowData } = await supabase.from('quote_rows').select('*').eq('job_id', job.id).order('row_index')
        if (rowData) setQuoteRows(rowData as QuoteRow[])
      }
    }, 3000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(poll)
    }
  }, [job?.id, step === 'upload' || step === 'preview']) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Re-run errors ────────────────────────────────────────────────────────────
  const rerunErrors = async () => {
    if (!job) return
    const resetIds  = quoteRows.filter((r) => r.status === 'error' || r.status === 'processing').map((r) => r.id)
    const doneCount = quoteRows.filter((r) => r.status === 'complete').length
    if (!resetIds.length) return
    await Promise.all([
      supabase.from('quote_rows')
        .update({
          status: 'pending', rate: null, transit_days: null, quote_number: null, error: null,
          winning_rate: null, winning_carrier: null, winning_source: null,
        })
        .in('id', resetIds),
      supabase.from('quote_jobs')
        .update({ status: 'pending', done_rows: doneCount, error: null })
        .eq('id', job.id),
    ])
    setQuoteRows((prev) =>
      prev.map((r) => (r.status === 'error' || r.status === 'processing')
        ? {
            ...r, status: 'pending' as const,
            rate: undefined, transit_days: undefined, quote_number: undefined, error: undefined,
            winning_rate: undefined, winning_carrier: undefined, winning_source: undefined,
          }
        : r
      )
    )
    setJob((j) => j ? { ...j, status: 'pending', done_rows: doneCount } : j)
    setStep('waiting')
  }

  // ── Reset ───────────────────────────────────────────────────────────────────
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
    setSelectedAccessorials(new Set())
    setTemperature('')
    setCommodity('')
    setIsStackable(false)
  }

  const hasClass    = freightClass !== ''
  const hasFile     = parsedRows.length > 0
  const canContinue = hasClass && hasFile

  const pct       = job ? Math.round((job.done_rows / job.total_rows) * 100) : 0
  const completed = quoteRows.filter((r) => r.status === 'complete').length
  const errors    = quoteRows.filter((r) => r.status === 'error').length

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>FFE + FreshX Reefer LTL Quote Bot</h1>
        <p className={styles.subtitle}>
          Upload a spreadsheet → both carriers quote each lane → winning rate lands in Supabase.
        </p>
        <StepIndicator current={step} />
      </div>

      {/* ── STEP 1: Upload ── */}
      {step === 'upload' && (
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Step 1 — Set Up Your Batch</h2>

          <div className={styles.nameField}>
            <label className={styles.classLabel}>Company Name</label>
            <input
              type="text"
              className={styles.input}
              placeholder="e.g. Acme Foods"
              value={quoteName}
              onChange={(e) => setQuoteName(e.target.value)}
              maxLength={120}
            />
          </div>
          <div className={styles.divider} />

          {/* 1a: Class */}
          <div className={`${styles.checkRow} ${hasClass ? styles.checkRowDone : ''}`}>
            <div className={styles.checkIcon}>{hasClass ? '✓' : '1'}</div>
            <div className={styles.checkBody}>
              <label className={styles.classLabel}>Freight Class / Commodity Type</label>
              <p className={styles.classHint}>Applies to every shipment in this batch (FFE).</p>
              <select
                className={`${styles.select} ${!hasClass ? styles.selectEmpty : ''}`}
                value={freightClass}
                onChange={(e) => setFreightClass(e.target.value)}
              >
                <option value="">— Select class or commodity —</option>
                <optgroup label="Commodity Type">
                  {COMMODITY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </optgroup>
                <optgroup label="Freight Class">
                  {CLASS_OPTIONS.map((c) => <option key={c} value={`Class ${c}`}>Class {c}</option>)}
                </optgroup>
              </select>
            </div>
          </div>

          <div className={styles.divider} />

          {/* 1b: File */}
          <div className={`${styles.checkRow} ${hasFile ? styles.checkRowDone : ''}`}>
            <div className={styles.checkIcon}>{hasFile ? '✓' : '2'}</div>
            <div className={styles.checkBody}>
              <p className={styles.classLabel}>Shipment Spreadsheet</p>
              <p className={styles.classHint}>
                Required columns: <code>Origin ZIP</code> · <code>Dest ZIP</code> · <code>Weight</code><br />
                Optional: <code>Pallets</code> (used by FreshX)<br />
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
                  >Change</button>
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

          {/* 1c: Accessorials */}
          <div className={styles.checkRow}>
            <div className={styles.checkIcon}>3</div>
            <div className={styles.checkBody}>
              <label className={styles.classLabel}>
                Accessorial Services
                <span className={styles.optionalTag}>Optional</span>
              </label>
              <p className={styles.classHint}>Select any that apply — applied to all lanes (FFE only).</p>
              <div className={styles.accessorialGrid}>
                {ACCESSORIALS.map((a) => (
                  <label key={a.key} className={styles.accessorialItem}>
                    <input
                      type="checkbox"
                      checked={selectedAccessorials.has(a.key)}
                      onChange={() => toggleAccessorial(a.key)}
                    />
                    <span>
                      {a.label}
                      {a.note && <span className={styles.accessorialNote}> ({a.note})</span>}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className={styles.divider} />

          {/* 1d: FreshX */}
          <div className={styles.checkRow}>
            <div className={styles.checkIcon}>4</div>
            <div className={styles.checkBody}>
              <label className={styles.classLabel}>
                FreshX Settings
                <span className={styles.optionalTag}>Optional</span>
              </label>
              <p className={styles.classHint}>
                Required to get FreshX rates alongside FFE. Skip to run FFE only.
                Pallet count is read from the <code>Pallets</code> column in your spreadsheet.
              </p>
              <div className={styles.freshxSelectRow}>
                <div className={styles.freshxSelectField}>
                  <label className={styles.pricingLabel}>Temperature</label>
                  <select
                    className={`${styles.select} ${!temperature ? styles.selectEmpty : ''}`}
                    value={temperature}
                    onChange={(e) => setTemperature(e.target.value)}
                  >
                    <option value="">— None (FFE only) —</option>
                    {FRESHX_TEMPERATURES.map((t) => (
                      <option key={t.key} value={t.key}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div className={styles.freshxSelectField}>
                  <label className={styles.pricingLabel}>Commodity</label>
                  <select
                    className={`${styles.select} ${!commodity ? styles.selectEmpty : ''}`}
                    value={commodity}
                    onChange={(e) => setCommodity(e.target.value)}
                  >
                    <option value="">— None (FFE only) —</option>
                    {FRESHX_COMMODITIES.map((c) => (
                      <option key={c.key} value={c.key}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div className={styles.freshxSelectField}>
                  <label className={styles.pricingLabel}>Stackable</label>
                  <select
                    className={styles.select}
                    value={isStackable ? 'yes' : 'no'}
                    onChange={(e) => setIsStackable(e.target.value === 'yes')}
                  >
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </div>
              </div>
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
            FFE class: <strong>{freightClass}</strong>
            {temperature && <> · FreshX temp: <strong>{temperature}</strong></>}
            {commodity && <> · <strong>{commodity}</strong></>}
            {temperature && <> · Stackable: <strong>{isStackable ? 'Yes' : 'No'}</strong></>}
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
          <ProgressBar pct={pct} done={job.done_rows} total={job.total_rows} completed={completed} processing={quoteRows.filter((r) => r.status === 'processing').length} errors={errors} />
          <PricingControls
            marginPct={marginPct} minProfit={minProfit} maxProfit={maxProfit}
            onMarginPct={setMarginPct} onMinProfit={setMinProfit} onMaxProfit={setMaxProfit}
            rows={quoteRows}
          />
          <ResultsTable rows={quoteRows} marginPct={marginPct} minProfit={minProfit} maxProfit={maxProfit} />
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
          <PricingControls
            marginPct={marginPct} minProfit={minProfit} maxProfit={maxProfit}
            onMarginPct={setMarginPct} onMinProfit={setMinProfit} onMaxProfit={setMaxProfit}
            rows={quoteRows}
          />
          <ResultsTable rows={quoteRows} marginPct={marginPct} minProfit={minProfit} maxProfit={maxProfit} />
          <div className={styles.actions}>
            {quoteRows.length > 0 && (
              <button className={styles.btnPrimary} onClick={() => downloadResults(quoteRows, quoteName, marginPct, minProfit, maxProfit)}>
                Download Results (.xlsx)
              </button>
            )}
            {errors > 0 && (
              <button className={styles.btnSecondary} onClick={rerunErrors}>
                ↺ Re-run {errors} Error{errors !== 1 ? 's' : ''}
              </button>
            )}
            <button className={styles.btnSecondary} onClick={reset}>Start Over</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────────

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

function ProgressBar({ pct, done, total, completed, errors, processing }: { pct: number; done: number; total: number; completed: number; errors: number; processing: number }) {
  const completedPct  = (completed / total) * 100
  const errorsPct     = (errors / total) * 100
  const processingPct = (processing / total) * 100
  return (
    <div className={styles.progressSection}>
      <div className={styles.progressBar}>
        <div className={`${styles.progressFill} ${styles.progressComplete}`}   style={{ width: `${completedPct}%` }} />
        <div className={`${styles.progressFill} ${styles.progressError}`}      style={{ width: `${errorsPct}%` }} />
        <div className={`${styles.progressFill} ${styles.progressProcessing}`} style={{ width: `${processingPct}%` }} />
      </div>
      <p className={styles.progressLabel}>{done} / {total} ({pct}%)</p>
      <div className={styles.progressStats}>
        <span className={styles.progressStat}><span className={styles.statDot} style={{ backgroundColor: 'var(--color-success-500)' }} />Complete: {completed}</span>
        <span className={styles.progressStat}><span className={styles.statDot} style={{ backgroundColor: 'var(--color-primary-500)' }} />Processing: {processing}</span>
        <span className={styles.progressStat}><span className={styles.statDot} style={{ backgroundColor: 'var(--color-error-500)' }} />Errors: {errors}</span>
      </div>
    </div>
  )
}

function ShipmentPreviewTable({ rows }: { rows: ShipmentRow[] }) {
  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr><th>#</th><th>Origin ZIP</th><th>Dest ZIP</th><th>Weight (lbs)</th><th>Pallets</th></tr>
        </thead>
        <tbody>
          {rows.slice(0, 50).map((r, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>{r.origin_zip}</td>
              <td>{r.dest_zip}</td>
              <td>{r.weight}</td>
              <td>{r.pallets ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 50 && <p className={styles.truncNote}>Showing first 50 of {rows.length} rows.</p>}
    </div>
  )
}

function PricingControls({
  marginPct, minProfit, maxProfit, onMarginPct, onMinProfit, onMaxProfit, rows,
}: {
  marginPct: number; minProfit: number; maxProfit: number
  onMarginPct: (v: number) => void; onMinProfit: (v: number) => void; onMaxProfit: (v: number) => void
  rows: QuoteRow[]
}) {
  const totals = rows.reduce(
    (acc, r) => {
      const p = calcPricing(r.winning_rate ?? r.rate, marginPct, minProfit, maxProfit)
      if (!p) return acc
      return { cost: acc.cost + p.cost, sell: acc.sell + p.sellPrice, gp: acc.gp + p.gp, count: acc.count + 1 }
    },
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

function ResultsTable({ rows, marginPct, minProfit, maxProfit }: { rows: QuoteRow[]; marginPct: number; minProfit: number; maxProfit: number }) {
  const priced = rows.map((r) => ({ r, p: calcPricing(r.winning_rate ?? r.rate, marginPct, minProfit, maxProfit) }))
  const totals = priced.reduce(
    (acc, { r, p }) => {
      const ffeCost = parseCost(r.rate)
      return {
        ffeCost:  acc.ffeCost  + (ffeCost ?? 0),
        ffeCount: acc.ffeCount + (ffeCost !== null ? 1 : 0),
        winCost:  acc.winCost  + (p ? p.cost : 0),
        sell:     acc.sell     + (p ? p.sellPrice : 0),
        gp:       acc.gp       + (p ? p.gp : 0),
        count:    acc.count    + (p ? 1 : 0),
      }
    },
    { ffeCost: 0, ffeCount: 0, winCost: 0, sell: 0, gp: 0, count: 0 }
  )

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>#</th><th>Origin</th><th>Dest</th><th>Weight</th><th>Status</th>
            <th>FFE Cost</th>
            <th>FreshX Rate</th><th>FreshX Carrier</th>
            <th>Winning Rate</th><th>Carrier</th><th>Source</th>
            <th>Sell Price</th><th>GP ($)</th>
            <th>Transit</th><th>Quote #</th><th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {priced.map(({ r, p }) => (
            <tr key={r.id || r.row_index} className={r.status === 'error' ? styles.rowError : r.status === 'complete' ? styles.rowComplete : ''}>
              <td>{r.row_index}</td>
              <td>{r.origin_zip}</td>
              <td>{r.dest_zip}</td>
              <td>{r.weight}</td>
              <td><StatusBadge status={r.status} /></td>
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
          ))}
        </tbody>
        {totals.count > 0 && (
          <tfoot>
            <tr className={styles.totalsRow}>
              <td colSpan={5} className={styles.totalsLabel}>Totals — {totals.count} lane{totals.count !== 1 ? 's' : ''}</td>
              <td className={styles.rateCell}>{totals.ffeCount > 0 ? fmtMoney(totals.ffeCost) : '—'}</td>
              <td colSpan={2} />
              <td className={styles.winnerCell}>{fmtMoney(totals.winCost)}</td>
              <td colSpan={2} />
              <td className={styles.sellCell}>{fmtMoney(totals.sell)}</td>
              <td className={styles.gpCell}>{fmtMoney(totals.gp)}</td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
