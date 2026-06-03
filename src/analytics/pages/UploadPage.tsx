import React, { useCallback, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { useAnalytics } from '../AnalyticsApp'
import styles from './UploadPage.module.css'

// Excel column → DB column mapping
const COL_MAP: Record<string, string> = {
  InvoiceNum:                               'invoice_num',
  QuoteRequestId:                           'quote_request_id',
  RateQuoteDetailId:                        'rate_quote_detail_id',
  BookedDate:                               'booked_date',
  InvoiceGroupId:                           'invoice_group_id',
  CustomerName:                             'customer_name',
  BranchName:                               'branch_name',
  SalesRep:                                 'sales_rep',
  AccountRep:                               'account_rep',
  DispatchRep:                              'dispatch_rep',
  QuoteCreator:                             'quote_creator',
  ScheduledPickupDate:                      'scheduled_pickup_date',
  ActualPickupDate:                         'actual_pickup_date',
  ScheduledDeliveryDate:                    'scheduled_delivery_date',
  ActualDeliveryDate:                       'actual_delivery_date',
  PickupLocationName:                       'pickup_location_name',
  PickupCity:                               'pickup_city',
  PickupState:                              'pickup_state',
  PickupZip:                                'pickup_zip',
  DropLocationName:                         'drop_location_name',
  DropCity:                                 'drop_city',
  DropState:                                'drop_state',
  DropZip:                                  'drop_zip',
  LineItemCount:                            'line_item_count',
  Commodities:                              'commodities',
  TotPackages:                              'tot_packages',
  TotWeight:                                'tot_weight',
  TotalLinearFeet:                          'total_linear_feet',
  MaxFreightClass:                          'max_freight_class',
  MaxLength:                                'max_length',
  MaxWidth:                                 'max_width',
  MaxHeight:                                'max_height',
  IsVltl:                                   'is_vltl',
  FzmkCarrierId:                            'fzmk_carrier_id',
  CurrentCarrierName:                       'current_carrier_name',
  QuoteAcceptedCarrierTariffName:           'quote_accepted_carrier_tariff_name',
  QuoteAcceptedCarrierTariffBillingName:    'quote_accepted_carrier_tariff_billing_name',
  ServiceLevel:                             'service_level',
  TransitDays:                              'transit_days',
  QuoteOrigRev:                             'quote_orig_rev',
  QuoteOriginalExp:                         'quote_original_exp',
  QuoteOrigProfit:                          'quote_orig_profit',
  ModifiedBy:                               'modified_by',
  NetChange:                                'net_change',
  QuoteCurrentRev:                          'quote_current_rev',
  QuoteCurrentExp:                          'quote_current_exp',
  QuoteCurrentProfit:                       'quote_current_profit',
  LoadRevenue:                              'load_revenue',
  LoadCarrierExpense:                       'load_carrier_expense',
  LoadOtherExpense:                         'load_other_expense',
  LoadProfit:                               'load_profit',
  LoadAccessorials:                         'load_accessorials',
  QuoteResponseAccessorials:                'quote_response_accessorials',
  QuoteResponseAccessorialCharges:          'quote_response_accessorial_charges',
  CheapestRev:                              'cheapest_rev',
  CheapestExp:                              'cheapest_exp',
  CheapestOptionCarrier:                    'cheapest_option_carrier',
  CheapestOptionCarrierTariffName:          'cheapest_option_carrier_tariff_name',
}

// Date fields need to be trimmed to "YYYY-MM-DD"
const DATE_FIELDS = new Set([
  'booked_date', 'scheduled_pickup_date', 'actual_pickup_date',
  'scheduled_delivery_date', 'actual_delivery_date',
])

function parseRow(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [xlsxKey, dbKey] of Object.entries(COL_MAP)) {
    let val = raw[xlsxKey]
    if (val === undefined || val === null || val === '') {
      out[dbKey] = null
      continue
    }
    if (DATE_FIELDS.has(dbKey)) {
      const s = String(val)
      out[dbKey] = s.length >= 10 ? s.slice(0, 10) : null
    } else if (typeof val === 'number') {
      out[dbKey] = val
    } else {
      out[dbKey] = String(val).trim() || null
    }
  }
  return out
}

const BATCH = 500

export default function UploadPage() {
  const { reload } = useAnalytics()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [status, setStatus] = useState<'idle' | 'parsing' | 'uploading' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [progress, setProgress] = useState(0)
  const [total, setTotal] = useState(0)

  const process = useCallback(async (file: File) => {
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      setStatus('error')
      setMessage('Please upload an Excel file (.xlsx or .xls)')
      return
    }

    setStatus('parsing')
    setMessage('Parsing Excel file…')
    setProgress(0)

    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf)
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null })

    if (!rawRows.length) {
      setStatus('error')
      setMessage('No rows found in the file.')
      return
    }

    const rows = rawRows.map(parseRow).filter(r => r.invoice_num)
    setTotal(rows.length)
    setStatus('uploading')

    let done = 0
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH)
      const { error } = await supabase
        .from('loads')
        .upsert(batch, { onConflict: 'invoice_num' })
      if (error) {
        setStatus('error')
        setMessage(`Upload error at row ${i}: ${error.message}`)
        return
      }
      done += batch.length
      setProgress(done)
      setMessage(`Uploading… ${done} / ${rows.length} rows`)
    }

    setStatus('done')
    setMessage(`Done! ${rows.length} loads upserted (new + updated).`)
    reload()
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
        Upload your LTL Load Details Excel export. Rows are upserted by Invoice# — re-uploading the same file is safe.
      </p>

      <div
        className={`${styles.dropZone} ${dragging ? styles.dragging : ''} ${status === 'done' ? styles.success : ''}`}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
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
        {status === 'parsing' && <div className={styles.spinner}>Parsing…</div>}
        {status === 'uploading' && (
          <div className={styles.progressWrap}>
            <div className={styles.progressLabel}>{message}</div>
            <div className={styles.progressTrack}>
              <div
                className={styles.progressFill}
                style={{ width: `${total ? (progress / total) * 100 : 0}%` }}
              />
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

      {status === 'done' && (
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
