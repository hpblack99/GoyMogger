-- RFP Customer Tracker migration
-- Run this in your Supabase dashboard → SQL Editor

-- 1. User-defined customer groups (separate from the UI umbrella groups)
CREATE TABLE IF NOT EXISTS customer_groups (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

-- 2. Customer settings — one row per unique customer_name from loads
CREATE TABLE IF NOT EXISTS customers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL UNIQUE,   -- must match customer_name in loads exactly
  is_rfp_customer boolean NOT NULL DEFAULT false,
  parent_id       uuid REFERENCES customers(id) ON DELETE SET NULL,  -- child → parent rollup
  group_id        uuid REFERENCES customer_groups(id) ON DELETE SET NULL,
  notes           text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- 3. Backfill all existing customers from loads (safe to re-run)
INSERT INTO customers (name)
SELECT DISTINCT customer_name
FROM loads
WHERE customer_name IS NOT NULL AND customer_name <> ''
ON CONFLICT (name) DO NOTHING;

-- 4. Manually-tracked RFP bids / pending proposals
CREATE TABLE IF NOT EXISTS rfp_bids (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  description       text,
  lanes             int,
  estimated_revenue numeric,
  estimated_profit  numeric,
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','won','lost','declined')),
  bid_date          date,
  decision_date     date,
  notes             text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- 5. Row-level security (authenticated users can read/write everything)
ALTER TABLE customer_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfp_bids         ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all" ON customer_groups FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON customers        FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON rfp_bids         FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 6. Helper function called after each file upload to add new customers automatically
CREATE OR REPLACE FUNCTION sync_customers_from_loads()
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO customers (name)
  SELECT DISTINCT customer_name
  FROM loads
  WHERE customer_name IS NOT NULL AND customer_name <> ''
  ON CONFLICT (name) DO NOTHING;
$$;
