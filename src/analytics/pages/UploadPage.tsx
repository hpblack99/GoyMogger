import React, { useCallback, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAnalytics } from '../AnalyticsApp'
import styles from './UploadPage.module.css'

type WorkerMsg =
  | { type: 'start';  total: number }
  | { type: 'batch';  rows: Record<string, unknown>[]; processed: number }
  | { type: 'done' }
  | { type: 'error';  message: string }

export default function UploadPage() {
  const { reload } = useAnalytics()
  const inputRef = useRef<HTMLInputElement>(null)
  const workerRef = useRef<Worker | null>(null)

  const [dragging, setDragging]  = useState(false)
  const [status,   setStatus]    = useState<'idle' | 'parsing' | 'uploading' | 'done' | 'error'>('idle')
  const [message,  setMessage]   = useState('')
  const [progress, setProgress]  = useState(0)
  const [total,    setTotal]     = useState(0)

  const process = useCallback(async (file: File) => {
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      setStatus('error')
      setMessage('Please upload an Excel file (.xlsx or .xls)')
      return
    }

    // Terminate any previous worker
    workerRef.current?.terminate()

    setStatus('parsing')
    setMessage('Reading file…')
    setProgress(0)
    setTotal(0)

    // Transfer the buffer to the worker (zero-copy)
    const buf = await file.arrayBuffer()

    const worker = new Worker(
      new URL('../workers/xlsxWorker.ts', import.meta.url),
      { type: 'module' },
    )
    workerRef.current = worker

    let done = 0
    let rowTotal = 0
    let uploadError = false

    worker.onmessage = async (e: MessageEvent<WorkerMsg>) => {
      const msg = e.data

      if (msg.type === 'start') {
        rowTotal = msg.total
        setTotal(msg.total)
        setStatus('uploading')
        return
      }

      if (msg.type === 'batch') {
        if (uploadError) return

        const { error } = await supabase
          .from('loads')
          .upsert(msg.rows, { onConflict: 'invoice_num' })

        if (error) {
          uploadError = true
          worker.terminate()
          setStatus('error')
          setMessage(`Upload error at row ${done}: ${error.message}`)
          return
        }

        done += msg.rows.length
        setProgress(done)
        setMessage(`Uploading… ${done.toLocaleString()} / ${rowTotal.toLocaleString()} rows`)
        return
      }

      if (msg.type === 'done') {
        worker.terminate()
        workerRef.current = null
        setStatus('done')
        setMessage(`Done! ${done.toLocaleString()} loads upserted (new + updated).`)
        reload()
        return
      }

      if (msg.type === 'error') {
        worker.terminate()
        workerRef.current = null
        setStatus('error')
        setMessage(msg.message)
      }
    }

    worker.onerror = (err) => {
      setStatus('error')
      setMessage(err.message ?? 'Worker error')
      worker.terminate()
      workerRef.current = null
    }

    // Transfer ownership of the buffer — worker heap, not main thread
    worker.postMessage(buf, [buf])
  }, [reload])

  const onFiles = useCallback((files: FileList | null) => {
    if (!files?.length) return
    process(files[0])
  }, [process])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    onFiles(e.dataTransfer.files)
  }, [onFiles])

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Upload Load Data</h1>
      <p className={styles.sub}>
        Upload your LTL Load Details Excel export. Rows are upserted by Invoice# — re-uploading the same file is safe. Handles large files (500K+ rows) without crashing.
      </p>

      <div
        className={`${styles.dropZone} ${dragging ? styles.dragging : ''} ${status === 'done' ? styles.success : ''}`}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => status === 'idle' || status === 'done' || status === 'error' ? inputRef.current?.click() : undefined}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          className={styles.hidden}
          onChange={e => onFiles(e.target.files)}
        />
        {status === 'idle' && (
          <>
            <div className={styles.dropIcon}>📊</div>
            <div className={styles.dropTitle}>Drop your Excel file here</div>
            <div className={styles.dropSub}>or click to browse — .xlsx / .xls accepted</div>
          </>
        )}
        {status === 'parsing' && (
          <>
            <div className={styles.spinner} />
            <div className={styles.dropTitle}>Reading file…</div>
            <div className={styles.dropSub}>Parsing Excel in background</div>
          </>
        )}
        {status === 'uploading' && (
          <div className={styles.progressWrap}>
            <div className={styles.progressLabel}>{message}</div>
            <div className={styles.progressTrack}>
              <div
                className={styles.progressFill}
                style={{ width: `${total ? (progress / total) * 100 : 0}%` }}
              />
            </div>
            <div className={styles.progressPct}>
              {total ? `${((progress / total) * 100).toFixed(1)}%` : '…'}
            </div>
          </div>
        )}
        {status === 'done' && (
          <>
            <div className={styles.dropIcon}>✅</div>
            <div className={styles.dropTitle}>{message}</div>
            <div className={styles.dropSub}>Click or drop another file to upload more data</div>
          </>
        )}
        {status === 'error' && (
          <>
            <div className={styles.dropIcon}>❌</div>
            <div className={styles.dropTitle}>Upload failed</div>
            <div className={styles.dropSub}>{message}</div>
          </>
        )}
      </div>

      {(status === 'done' || status === 'error') && (
        <button
          className={styles.resetBtn}
          onClick={() => { setStatus('idle'); setMessage(''); setProgress(0); setTotal(0) }}
        >
          Upload another file
        </button>
      )}
    </div>
  )
}
