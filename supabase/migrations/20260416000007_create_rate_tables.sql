CREATE TABLE rate_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES api_customers(id) ON DELETE SET NULL,
  request_payload JSONB NOT NULL,
  origin_zip TEXT NOT NULL,
  dest_zip TEXT NOT NULL,
  origin_country TEXT DEFAULT 'US',
  dest_country TEXT DEFAULT 'US',
  total_weight NUMERIC,
  freight_class TEXT,
  carriers_requested TEXT[],
  carriers_responded TEXT[],
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  response_time_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rate_requests_customer ON rate_requests(customer_id);
CREATE INDEX idx_rate_requests_created ON rate_requests(created_at DESC);
CREATE INDEX idx_rate_requests_origin_dest ON rate_requests(origin_zip, dest_zip);

CREATE TABLE rate_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES rate_requests(id) ON DELETE CASCADE,
  carrier_id UUID REFERENCES carriers(id) ON DELETE SET NULL,
  scac TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  total_charge NUMERIC,
  transit_days INTEGER,
  service_level TEXT,
  effective_date DATE,
  expiry_date DATE,
  raw_response JSONB,
  normalized_response JSONB,
  error_message TEXT,
  response_time_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rate_responses_request ON rate_responses(request_id);
CREATE INDEX idx_rate_responses_scac ON rate_responses(scac);
CREATE INDEX idx_rate_responses_created ON rate_responses(created_at DESC);
