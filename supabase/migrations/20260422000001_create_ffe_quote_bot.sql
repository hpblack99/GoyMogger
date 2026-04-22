-- FFE Reefer LTL Quote Bot tables
-- quote_jobs: one record per batch submitted from the React UI
-- quote_rows: one record per shipment line within a batch

CREATE TABLE quote_jobs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  status       TEXT        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'running', 'complete', 'error')),
  total_rows   INTEGER     NOT NULL DEFAULT 0,
  done_rows    INTEGER     NOT NULL DEFAULT 0,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quote_jobs_status ON quote_jobs(status);

CREATE TRIGGER quote_jobs_updated_at
  BEFORE UPDATE ON quote_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


CREATE TABLE quote_rows (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID        NOT NULL REFERENCES quote_jobs(id) ON DELETE CASCADE,
  row_index     INTEGER     NOT NULL,
  origin_zip    TEXT        NOT NULL,
  dest_zip      TEXT        NOT NULL,
  weight        NUMERIC     NOT NULL,
  freight_class TEXT        NOT NULL,
  pieces        INTEGER,
  commodity     TEXT,
  status        TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'processing', 'complete', 'error')),
  rate          TEXT,
  transit_days  TEXT,
  quote_number  TEXT,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quote_rows_job    ON quote_rows(job_id);
CREATE INDEX idx_quote_rows_status ON quote_rows(job_id, status);

CREATE TRIGGER quote_rows_updated_at
  BEFORE UPDATE ON quote_rows
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- RLS: allow all for now (tighten per-user if auth is added later)
ALTER TABLE quote_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quote_jobs_all" ON quote_jobs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "quote_rows_all" ON quote_rows FOR ALL USING (true) WITH CHECK (true);
