-- P44 OAuth token cache (singleton row pattern)
CREATE TABLE IF NOT EXISTS p44_token_cache (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  access_token text       NOT NULL,
  expires_at   timestamptz NOT NULL,
  updated_at   timestamptz DEFAULT now() NOT NULL
);

-- Only service-role should touch this table; no public access
ALTER TABLE p44_token_cache ENABLE ROW LEVEL SECURITY;
-- No RLS policies added — only the edge function (service role) reads/writes this table
