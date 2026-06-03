export interface Load {
  id: string
  invoice_num: string
  quote_request_id: string | null
  rate_quote_detail_id: string | null
  booked_date: string | null
  invoice_group_id: string | null
  customer_name: string | null
  branch_name: string | null
  sales_rep: string | null
  account_rep: string | null
  dispatch_rep: string | null
  quote_creator: string | null
  scheduled_pickup_date: string | null
  actual_pickup_date: string | null
  scheduled_delivery_date: string | null
  actual_delivery_date: string | null
  pickup_location_name: string | null
  pickup_city: string | null
  pickup_state: string | null
  pickup_zip: string | null
  drop_location_name: string | null
  drop_city: string | null
  drop_state: string | null
  drop_zip: string | null
  line_item_count: number | null
  commodities: string | null
  tot_packages: number | null
  tot_weight: number | null
  total_linear_feet: number | null
  max_freight_class: string | null
  max_length: number | null
  max_width: number | null
  max_height: number | null
  is_vltl: boolean | null
  fzmk_carrier_id: string | null
  current_carrier_name: string | null
  quote_accepted_carrier_tariff_name: string | null
  quote_accepted_carrier_tariff_billing_name: string | null
  service_level: string | null
  transit_days: number | null
  quote_orig_rev: number | null
  quote_original_exp: number | null
  quote_orig_profit: number | null
  modified_by: string | null
  net_change: number | null
  quote_current_rev: number | null
  quote_current_exp: number | null
  quote_current_profit: number | null
  load_revenue: number | null
  load_carrier_expense: number | null
  load_other_expense: number | null
  load_profit: number | null
  load_accessorials: string | null
  quote_response_accessorials: string | null
  quote_response_accessorial_charges: string | null
  cheapest_rev: number | null
  cheapest_exp: number | null
  cheapest_option_carrier: string | null
  cheapest_option_carrier_tariff_name: string | null
  created_at: string | null
  updated_at: string | null
}

export interface KPIs {
  revenue: number
  cost: number
  profit: number
  margin: number
  loadCount: number
  revenuePerLoad: number
  profitPerLoad: number
  activeCustomers: number
  activeSalesReps: number
}

export interface PeriodKPIs {
  current: KPIs
  prior: KPIs
  changes: Record<keyof KPIs, number>
}

export interface AnalyticsFilters {
  dateFrom: string
  dateTo: string
  customer: string
  salesRep: string
  branch: string
}

export interface EntitySummary {
  name: string
  revenue: number
  cost: number
  profit: number
  margin: number
  loadCount: number
  revenuePerLoad: number
  profitPerLoad: number
}

export interface TrendPoint {
  period: string
  revenue: number
  profit: number
  cost: number
  margin: number
  loadCount: number
  revenuePerLoad: number
  profitPerLoad: number
}

export interface Alert {
  id: string
  severity: 'critical' | 'warning' | 'info'
  category: string
  title: string
  detail: string
  value?: string
  metric?: string
}

export interface ChargeCategory {
  name: string
  total: number
  pct: number
  loadCount: number
  avgPerLoad: number
}
