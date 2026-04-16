CREATE TABLE api_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES api_customers(id) ON DELETE SET NULL,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  status_code INTEGER,
  request_id UUID,
  ip_address TEXT,
  response_time_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_api_usage_customer_created ON api_usage(customer_id, created_at DESC);
CREATE INDEX idx_api_usage_endpoint ON api_usage(endpoint, created_at DESC);
CREATE INDEX idx_api_usage_created ON api_usage(created_at DESC);

-- Seed common LTL carriers
INSERT INTO carriers (scac, name, api_type, supports_rates, supports_booking, supports_tracking, config) VALUES
  ('XPOF', 'XPO Logistics',              'rest', true, true, true,  '{"baseUrl":"https://api.ltl.xpo.com/freight/1.0"}'),
  ('ODFL', 'Old Dominion Freight Line',  'soap', true, true, true,  '{"baseUrl":"https://www.odfl.com/ws/soap"}'),
  ('FXFE', 'FedEx Freight',              'rest', true, true, true,  '{"baseUrl":"https://apis.fedex.com"}'),
  ('UPGF', 'UPS Freight',               'rest', true, true, true,  '{"baseUrl":"https://wwwcie.ups.com/api"}'),
  ('SEFL', 'Southeastern Freight Lines', 'rest', true, true, true,  '{"baseUrl":"https://www.sefl.com/api"}'),
  ('SAIA', 'Saia LTL Freight',           'soap', true, true, true,  '{"baseUrl":"https://www.saia.com/wsdl"}'),
  ('RDWY', 'Yellow (YRC)',               'rest', true, true, true,  '{"baseUrl":"https://myyrc.com/api"}'),
  ('AVRT', 'Averitt Express',            'rest', true, true, true,  '{"baseUrl":"https://www.averittexpress.com/api"}'),
  ('RLCA', 'R+L Carriers',              'rest', true, true, true,  '{"baseUrl":"https://api.rlcarriers.com"}'),
  ('EXLA', 'Estes Express Lines',        'rest', true, true, true,  '{"baseUrl":"https://api.estes-express.com/v1"}'),
  ('DAYTON','Dayton Freight',            'rest', true, true, true,  '{"baseUrl":"https://www.daytonfreight.com/api"}'),
  ('NEMF', 'New England Motor Freight',  'rest', true, true, true,  '{"baseUrl":"https://www.nemf.com/api"}'),
  ('PITT', 'AAA Cooper Transportation',  'rest', true, true, true,  '{"baseUrl":"https://www.aaacooper.com/api"}'),
  ('HMES', 'Holland Motor Express',      'rest', true, true, true,  '{"baseUrl":"https://myholland.com/api"}'),
  ('WARD', 'Ward Transport',             'rest', true, true, true,  '{"baseUrl":"https://www.wardtransport.com/api"}'),
  ('CTII', 'Central Transport',          'rest', true, true, true,  '{"baseUrl":"https://www.centraltransportintl.com/api"}'),
  ('CWAY', 'Crossway',                   'rest', true, true, false, '{"baseUrl":"https://api.crossway.com"}'),
  ('SMTL', 'USF Holland',               'rest', true, true, true,  '{"baseUrl":"https://myholland.com/api"}'),
  ('CNWY', 'XPO LTL (Con-way)',          'rest', true, true, true,  '{"baseUrl":"https://api.ltl.xpo.com/freight/1.0"}'),
  ('PYLE', 'Estes (PYLE)',               'rest', true, true, true,  '{"baseUrl":"https://api.estes-express.com/v1"}');
