/// <reference lib="webworker" />
import * as XLSX from 'xlsx'

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

const DATE_FIELDS = new Set([
  'booked_date', 'scheduled_pickup_date', 'actual_pickup_date',
  'scheduled_delivery_date', 'actual_delivery_date',
])

// Fields stored as boolean in DB — Excel value is "Y" / blank
const BOOLEAN_FIELDS = new Set(['is_vltl'])

// Normalize a header: lowercase, strip spaces/underscores/hyphens
function normalize(s: string) { return s.toLowerCase().replace(/[\s_\-]/g, '') }

// Build a lookup: normalized Excel header → db column name
const NORMALIZED_MAP: Record<string, string> = {}
for (const [k, v] of Object.entries(COL_MAP)) {
  NORMALIZED_MAP[normalize(k)] = v
}

function parseRow(raw: Record<string, unknown>, headerMap: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [rawKey, dbKey] of Object.entries(headerMap)) {
    const val = raw[rawKey]
    if (val === undefined || val === null || val === '') {
      out[dbKey] = BOOLEAN_FIELDS.has(dbKey) ? false : null
      continue
    }
    if (BOOLEAN_FIELDS.has(dbKey)) {
      const s = String(val).trim().toUpperCase()
      out[dbKey] = s === 'Y' || s === 'YES' || s === 'TRUE' || s === '1'
    } else if (DATE_FIELDS.has(dbKey)) {
      if (val instanceof Date) {
        out[dbKey] = val.toISOString().slice(0, 10)
      } else {
        const s = String(val)
        out[dbKey] = s.length >= 10 ? s.slice(0, 10) : null
      }
    } else if (typeof val === 'number') {
      out[dbKey] = val
    } else {
      out[dbKey] = String(val).trim() || null
    }
  }
  return out
}

const BATCH = 500

self.onmessage = (e: MessageEvent<ArrayBuffer>) => {
  const buf = e.data
  try {
    const wb = XLSX.read(buf, { cellDates: true, dense: false })
    const ws = wb.Sheets[wb.SheetNames[0]]

    if (!ws['!ref']) {
      self.postMessage({ type: 'error', message: 'Worksheet is empty.' })
      return
    }

    const range = XLSX.utils.decode_range(ws['!ref'])
    const lastDataRow = range.e.r   // row 0 = headers
    const totalRows = lastDataRow   // number of data rows

    if (totalRows < 1) {
      self.postMessage({ type: 'error', message: 'No data rows found.' })
      return
    }

    // Extract header row (row 0) and build a runtime map: raw header → db column
    const headers: string[] = []
    const headerMap: Record<string, string> = {} // rawHeader → dbKey
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c })]
      const h = cell ? String(cell.v).trim() : `col_${c}`
      headers.push(h)
      const dbKey = NORMALIZED_MAP[normalize(h)]
      if (dbKey) headerMap[h] = dbKey
    }

    const mappedCount = Object.keys(headerMap).length
    if (mappedCount === 0) {
      self.postMessage({ type: 'error', message: `No recognized column headers found. First few headers: ${headers.slice(0, 5).join(', ')}` })
      return
    }

    self.postMessage({ type: 'start', total: totalRows })

    for (let startRow = 1; startRow <= lastDataRow; startRow += BATCH) {
      const endRow = Math.min(startRow + BATCH - 1, lastDataRow)

      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
        header: headers,
        range: { s: { r: startRow, c: range.s.c }, e: { r: endRow, c: range.e.c } },
        defval: null,
      })

      const rows = raw.map(r => parseRow(r, headerMap)).filter(r => r['invoice_num'])
      self.postMessage({ type: 'batch', rows, processed: endRow })
    }

    self.postMessage({ type: 'done' })
  } catch (err: unknown) {
    self.postMessage({ type: 'error', message: String(err instanceof Error ? err.message : err) })
  }
}
