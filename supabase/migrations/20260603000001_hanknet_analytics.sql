-- HankNet Analytics: loads table and charge-detail table

CREATE TABLE IF NOT EXISTS loads (
  id                                     uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_num                            text        UNIQUE NOT NULL,
  quote_request_id                       text,
  rate_quote_detail_id                   text,
  booked_date                            date,
  invoice_group_id                       text,
  customer_name                          text,
  branch_name                            text,
  sales_rep                              text,
  account_rep                            text,
  dispatch_rep                           text,
  quote_creator                          text,
  scheduled_pickup_date                  date,
  actual_pickup_date                     date,
  scheduled_delivery_date                date,
  actual_delivery_date                   date,
  pickup_location_name                   text,
  pickup_city                            text,
  pickup_state                           text,
  pickup_zip                             text,
  drop_location_name                     text,
  drop_city                              text,
  drop_state                             text,
  drop_zip                               text,
  line_item_count                        integer,
  commodities                            text,
  tot_packages                           integer,
  tot_weight                             numeric,
  total_linear_feet                      numeric,
  max_freight_class                      text,
  max_length                             numeric,
  max_width                              numeric,
  max_height                             numeric,
  is_vltl                                boolean,
  fzmk_carrier_id                        text,
  current_carrier_name                   text,
  quote_accepted_carrier_tariff_name     text,
  quote_accepted_carrier_tariff_billing_name text,
  service_level                          text,
  transit_days                           integer,
  quote_orig_rev                         numeric,
  quote_original_exp                     numeric,
  quote_orig_profit                      numeric,
  modified_by                            text,
  net_change                             numeric,
  quote_current_rev                      numeric,
  quote_current_exp                      numeric,
  quote_current_profit                   numeric,
  load_revenue                           numeric,
  load_carrier_expense                   numeric,
  load_other_expense                     numeric,
  load_profit                            numeric,
  load_accessorials                      text,
  quote_response_accessorials            text,
  quote_response_accessorial_charges     text,
  cheapest_rev                           numeric,
  cheapest_exp                           numeric,
  cheapest_option_carrier                text,
  cheapest_option_carrier_tariff_name    text,
  created_at                             timestamptz DEFAULT now(),
  updated_at                             timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loads_booked_date  ON loads (booked_date);
CREATE INDEX IF NOT EXISTS idx_loads_customer      ON loads (customer_name);
CREATE INDEX IF NOT EXISTS idx_loads_sales_rep     ON loads (sales_rep);
CREATE INDEX IF NOT EXISTS idx_loads_branch        ON loads (branch_name);
CREATE INDEX IF NOT EXISTS idx_loads_carrier       ON loads (current_carrier_name);

-- Charge detail rows — separate upload, keyed by invoice + charge type
CREATE TABLE IF NOT EXISTS load_charges (
  id                      uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_num             text    NOT NULL REFERENCES loads (invoice_num) ON DELETE CASCADE,
  payable_charge_type_id  text,
  type                    text,
  description             text,
  units                   numeric,
  unit_rate               numeric,
  subtotal                numeric,
  charge_category         text,
  created_at              timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_load_charges_invoice ON load_charges (invoice_num);

-- RLS: allow anon reads (dashboard is read-heavy); writes require service role via upload page
ALTER TABLE loads        ENABLE ROW LEVEL SECURITY;
ALTER TABLE load_charges ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "anon can read loads"
  ON loads FOR SELECT USING (true);

CREATE POLICY IF NOT EXISTS "anon can upsert loads"
  ON loads FOR INSERT WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "anon can update loads"
  ON loads FOR UPDATE USING (true);

CREATE POLICY IF NOT EXISTS "anon can read load_charges"
  ON load_charges FOR SELECT USING (true);

CREATE POLICY IF NOT EXISTS "anon can insert load_charges"
  ON load_charges FOR INSERT WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "anon can delete load_charges"
  ON load_charges FOR DELETE USING (true);
