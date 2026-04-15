-- ============================================================
-- quotes  — one row per rate-quote request
-- ============================================================
CREATE TABLE IF NOT EXISTS quotes (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  quote_request_id    text        NOT NULL,          -- client-generated idempotency key
  origin_zip          text        NOT NULL,
  origin_city         text,
  origin_state        text,
  origin_country      text        NOT NULL DEFAULT 'US',
  destination_zip     text        NOT NULL,
  destination_city    text,
  destination_state   text,
  destination_country text        NOT NULL DEFAULT 'US',
  pickup_date         date        NOT NULL,
  accessorials        jsonb       NOT NULL DEFAULT '{}',
  payment_terms       text,
  total_weight        numeric,                       -- computed from line items
  status              text        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'completed', 'error')),
  error_message       text,
  user_id             uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quotes_user_id_idx     ON quotes (user_id);
CREATE INDEX IF NOT EXISTS quotes_created_at_idx  ON quotes (created_at DESC);
CREATE INDEX IF NOT EXISTS quotes_status_idx      ON quotes (status);

ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;

-- Authenticated users can see their own quotes; anonymous quotes are public to service role only
CREATE POLICY "Users read own quotes"
  ON quotes FOR SELECT
  USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users insert own quotes"
  ON quotes FOR INSERT
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);


-- ============================================================
-- quote_line_items  — freight items for a quote request
-- ============================================================
CREATE TABLE IF NOT EXISTS quote_line_items (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  quote_id        uuid        NOT NULL REFERENCES quotes (id) ON DELETE CASCADE,
  description     text        NOT NULL DEFAULT 'Freight',
  weight_lbs      numeric     NOT NULL CHECK (weight_lbs > 0),
  pieces          integer     NOT NULL DEFAULT 1 CHECK (pieces > 0),
  freight_class   text        NOT NULL,
  packaging_type  text        NOT NULL DEFAULT 'PLT',
  length_in       numeric,
  width_in        numeric,
  height_in       numeric,
  nmfc            text,
  stackable       boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quote_line_items_quote_id_idx ON quote_line_items (quote_id);

ALTER TABLE quote_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own quote line items"
  ON quote_line_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM quotes q
      WHERE q.id = quote_line_items.quote_id
        AND (q.user_id = auth.uid() OR q.user_id IS NULL)
    )
  );

CREATE POLICY "Users insert own quote line items"
  ON quote_line_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM quotes q
      WHERE q.id = quote_line_items.quote_id
        AND (q.user_id = auth.uid() OR q.user_id IS NULL)
    )
  );


-- ============================================================
-- quote_results  — carrier rates returned by Project44
-- ============================================================
CREATE TABLE IF NOT EXISTS quote_results (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  quote_id        uuid        NOT NULL REFERENCES quotes (id) ON DELETE CASCADE,
  carrier_name    text,
  carrier_scac    text,
  service_level   text,
  total_rate      numeric,
  currency        text        NOT NULL DEFAULT 'USD',
  transit_days    integer,
  estimated_delivery_date date,
  guaranteed      boolean     NOT NULL DEFAULT false,
  raw_response    jsonb,                             -- full P44 rateQuote object
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quote_results_quote_id_idx ON quote_results (quote_id);
CREATE INDEX IF NOT EXISTS quote_results_total_rate_idx ON quote_results (total_rate ASC);

ALTER TABLE quote_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own quote results"
  ON quote_results FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM quotes q
      WHERE q.id = quote_results.quote_id
        AND (q.user_id = auth.uid() OR q.user_id IS NULL)
    )
  );
