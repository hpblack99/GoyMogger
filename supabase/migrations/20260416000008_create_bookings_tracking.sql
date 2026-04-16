CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES api_customers(id) ON DELETE SET NULL,
  carrier_id UUID REFERENCES carriers(id) ON DELETE SET NULL,
  scac TEXT NOT NULL,
  pro_number TEXT,
  bol_number TEXT,
  pickup_confirmation TEXT,
  rate_request_id UUID REFERENCES rate_requests(id) ON DELETE SET NULL,
  booking_payload JSONB NOT NULL,
  carrier_response JSONB,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','confirmed','picked_up','in_transit','delivered','cancelled','failed')),
  pickup_date DATE,
  estimated_delivery DATE,
  actual_delivery TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bookings_customer ON bookings(customer_id);
CREATE INDEX idx_bookings_scac ON bookings(scac);
CREATE INDEX idx_bookings_pro ON bookings(pro_number);
CREATE INDEX idx_bookings_bol ON bookings(bol_number);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_bookings_created ON bookings(created_at DESC);

CREATE TRIGGER bookings_updated_at
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE tracking_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
  carrier_id UUID REFERENCES carriers(id) ON DELETE SET NULL,
  scac TEXT NOT NULL,
  pro_number TEXT NOT NULL,
  event_code TEXT,
  event_description TEXT,
  event_location TEXT,
  event_city TEXT,
  event_state TEXT,
  event_zip TEXT,
  event_timestamp TIMESTAMPTZ,
  raw_event JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tracking_booking ON tracking_events(booking_id);
CREATE INDEX idx_tracking_pro ON tracking_events(pro_number);
CREATE INDEX idx_tracking_timestamp ON tracking_events(event_timestamp DESC);
CREATE UNIQUE INDEX idx_tracking_dedup ON tracking_events(pro_number, event_code, event_timestamp)
  WHERE event_timestamp IS NOT NULL;
