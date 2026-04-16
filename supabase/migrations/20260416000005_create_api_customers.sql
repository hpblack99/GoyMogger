CREATE TABLE api_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  api_key TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  api_secret TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  is_active BOOLEAN DEFAULT true,
  rate_limit_per_minute INTEGER DEFAULT 60,
  rate_limit_per_day INTEGER DEFAULT 10000,
  allowed_endpoints TEXT[] DEFAULT ARRAY['rates', 'book', 'track'],
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_api_customers_api_key ON api_customers(api_key);
CREATE INDEX idx_api_customers_email ON api_customers(email);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER api_customers_updated_at
  BEFORE UPDATE ON api_customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
