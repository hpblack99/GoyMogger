CREATE TABLE carriers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scac TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  api_type TEXT NOT NULL CHECK (api_type IN ('rest', 'soap', 'edi')),
  is_active BOOLEAN DEFAULT true,
  supports_rates BOOLEAN DEFAULT true,
  supports_booking BOOLEAN DEFAULT true,
  supports_tracking BOOLEAN DEFAULT true,
  supports_bol BOOLEAN DEFAULT false,
  timeout_ms INTEGER DEFAULT 30000,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_carriers_scac ON carriers(scac);
CREATE INDEX idx_carriers_active ON carriers(is_active);

CREATE TRIGGER carriers_updated_at
  BEFORE UPDATE ON carriers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE carrier_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id UUID NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES api_customers(id) ON DELETE CASCADE,
  credentials JSONB NOT NULL,
  environment TEXT DEFAULT 'production' CHECK (environment IN ('test', 'production')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(carrier_id, customer_id, environment)
);

CREATE INDEX idx_carrier_creds_carrier ON carrier_credentials(carrier_id);
CREATE INDEX idx_carrier_creds_customer ON carrier_credentials(customer_id);

CREATE TRIGGER carrier_credentials_updated_at
  BEFORE UPDATE ON carrier_credentials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
