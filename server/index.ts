import express from 'express'
import cors from 'cors'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import * as XLSX from 'xlsx'
import { FFEQuoter } from './quoter'
import { Job, ShipmentRow, QuoteResult } from './types'

const app = express()
const PORT = process.env.SERVER_PORT || 3001

app.use(cors())
app.use(express.json({ limit: '10mb' }))

// In-memory job store (survives for the process lifetime)
const jobs = new Map<string, Job>()

const UPLOADS_DIR = path.join(process.cwd(), 'server', 'uploads')
const RESULTS_DIR = path.join(process.cwd(), 'server', 'results')
;[UPLOADS_DIR, RESULTS_DIR].forEach((d) => fs.mkdirSync(d, { recursive: true }))

const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (['.csv', '.xlsx', '.xls'].includes(ext)) {
      cb(null, true)
    } else {
      cb(new Error('Only CSV and Excel files (.csv, .xlsx, .xls) are accepted'))
    }
  },
})

// ──────────────────────────────────────────────────────────
// Spreadsheet parsing
// ──────────────────────────────────────────────────────────

const COLUMN_PATTERNS: Record<keyof Omit<ShipmentRow, 'rowIndex'>, RegExp> = {
  originZip: /origin|orig|shipper.?zip|o.*zip/i,
  destZip: /dest|destination|consignee.?zip|d.*zip/i,
  weight: /weight|wt\b/i,
  freightClass: /class|nmfc/i,
  pieces: /piece|pallet|qty|count/i,
  commodity: /commodity|description|desc\b/i,
}

function parseSpreadsheet(filePath: string): ShipmentRow[] {
  const workbook = XLSX.readFile(filePath)
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<(string | number | undefined)[]>(sheet, { header: 1 })

  if (raw.length < 2) {
    throw new Error('Spreadsheet must have a header row and at least one data row.')
  }

  const headers = (raw[0] as (string | number | undefined)[]).map((h) =>
    String(h ?? '').trim()
  )

  // Map column keys to header indexes
  const colIndex: Partial<Record<keyof Omit<ShipmentRow, 'rowIndex'>, number>> = {}
  for (const [key, pattern] of Object.entries(COLUMN_PATTERNS)) {
    const idx = headers.findIndex((h) => pattern.test(h))
    if (idx >= 0) colIndex[key as keyof typeof colIndex] = idx
  }

  const required = ['originZip', 'destZip', 'weight', 'freightClass'] as const
  const missing = required.filter((k) => colIndex[k] === undefined)
  if (missing.length > 0) {
    throw new Error(
      `Missing required columns: ${missing.join(', ')}.\n` +
        `Found headers: ${headers.join(', ')}\n` +
        `Expected columns (flexible naming): origin zip, dest zip, weight, class`
    )
  }

  return raw
    .slice(1)
    .filter((row) => Array.isArray(row) && row.length > 0 && row[colIndex.originZip!])
    .map((row, i) => ({
      rowIndex: i + 1,
      originZip: String(row[colIndex.originZip!] ?? '').trim(),
      destZip: String(row[colIndex.destZip!] ?? '').trim(),
      weight: Number(row[colIndex.weight!] ?? 0),
      freightClass: String(row[colIndex.freightClass!] ?? '').trim(),
      pieces: colIndex.pieces !== undefined ? Number(row[colIndex.pieces]) || undefined : undefined,
      commodity:
        colIndex.commodity !== undefined
          ? String(row[colIndex.commodity] ?? '').trim() || undefined
          : undefined,
    }))
}

// ──────────────────────────────────────────────────────────
// Results Excel generation
// ──────────────────────────────────────────────────────────

function generateResultsFile(jobId: string, results: QuoteResult[]): string {
  const rows = results.map((r) => ({
    'Row #': r.rowIndex,
    'Origin ZIP': r.originZip,
    'Dest ZIP': r.destZip,
    'Weight (lbs)': r.weight,
    'Freight Class': r.freightClass,
    Pieces: r.pieces ?? '',
    Commodity: r.commodity ?? '',
    Rate: r.rate ?? '',
    'Transit Days': r.transitDays ?? '',
    'Quote #': r.quoteNumber ?? '',
    Status: r.status,
    Notes: r.error ?? '',
  }))

  const ws = XLSX.utils.json_to_sheet(rows)

  // Column widths
  ws['!cols'] = [
    { wch: 6 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 },
    { wch: 8 }, { wch: 20 }, { wch: 12 }, { wch: 14 }, { wch: 14 },
    { wch: 12 }, { wch: 40 },
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'FFE Quotes')

  const outPath = path.join(RESULTS_DIR, `quotes-${jobId}.xlsx`)
  XLSX.writeFile(wb, outPath)
  return outPath
}

// ──────────────────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────────────────

// POST /api/upload — parse spreadsheet, return rows for preview
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file provided' })
    return
  }
  try {
    const rows = parseSpreadsheet(req.file.path)
    if (rows.length === 0) {
      res.status(400).json({ error: 'No valid data rows found in the spreadsheet.' })
      return
    }
    res.json({ rows, count: rows.length })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to parse file' })
  } finally {
    // Clean up temp upload
    try { fs.unlinkSync(req.file!.path) } catch { /* ignore */ }
  }
})

// POST /api/run — start a quoting job
app.post('/api/run', (req, res) => {
  const { rows, username, password, debugMode } = req.body as {
    rows: ShipmentRow[]
    username: string
    password: string
    debugMode?: boolean
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: 'No shipment rows provided' })
    return
  }
  if (!username || !password) {
    res.status(400).json({ error: 'FFE username and password are required' })
    return
  }

  const jobId = crypto.randomUUID()
  const job: Job = {
    id: jobId,
    status: 'queued',
    progress: 0,
    total: rows.length,
    results: rows.map((r) => ({ ...r, status: 'pending' })),
    createdAt: new Date().toISOString(),
  }
  jobs.set(jobId, job)

  // Fire and forget — client polls /api/job/:id
  const quoter = new FFEQuoter(debugMode ?? false)
  job.status = 'running'

  quoter
    .processAll(rows, username, password, (result, progressCount) => {
      const j = jobs.get(jobId)
      if (!j) return
      j.progress = progressCount
      const idx = j.results.findIndex((r) => r.rowIndex === result.rowIndex)
      if (idx >= 0) j.results[idx] = result
    })
    .then((results) => {
      const j = jobs.get(jobId)
      if (!j) return
      j.results = results
      j.progress = results.length
      j.status = 'complete'
      j.completedAt = new Date().toISOString()
      generateResultsFile(jobId, results)
    })
    .catch((err) => {
      const j = jobs.get(jobId)
      if (!j) return
      j.status = 'error'
      j.error = err instanceof Error ? err.message : String(err)
      console.error('[FFE] Job failed:', j.error)
    })

  res.json({ jobId })
})

// GET /api/job/:id — poll job status and results
app.get('/api/job/:id', (req, res) => {
  const job = jobs.get(req.params.id)
  if (!job) {
    res.status(404).json({ error: 'Job not found' })
    return
  }
  res.json(job)
})

// GET /api/download/:id — download results xlsx
app.get('/api/download/:id', (req, res) => {
  const job = jobs.get(req.params.id)
  if (!job || job.status !== 'complete') {
    res.status(404).json({ error: 'Results not ready' })
    return
  }
  const filePath = path.join(RESULTS_DIR, `quotes-${req.params.id}.xlsx`)
  if (!fs.existsSync(filePath)) {
    // Regenerate if missing
    try {
      generateResultsFile(req.params.id, job.results)
    } catch {
      res.status(500).json({ error: 'Could not generate results file' })
      return
    }
  }
  const date = new Date().toISOString().split('T')[0]
  res.download(filePath, `ffe-reefer-quotes-${date}.xlsx`)
})

// GET /api/health
app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.listen(PORT, () => {
  console.log(`\n✓ FFE Quoter API listening on http://localhost:${PORT}`)
  console.log(`  Screenshots saved to: server/screenshots/\n`)
})
