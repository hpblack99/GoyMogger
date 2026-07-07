-- Composite indexes matching the worker's exact queries:
--   claim_job:  quote_jobs WHERE status='pending' ORDER BY created_at
--   fetch_rows: quote_rows WHERE job_id=? AND status IN (...) ORDER BY row_index
CREATE INDEX IF NOT EXISTS idx_quote_jobs_status_created ON quote_jobs (status, created_at);
CREATE INDEX IF NOT EXISTS idx_quote_rows_job_status     ON quote_rows (job_id, status, row_index);

-- Pin search_path on our trigger/RPC functions (security advisor: mutable search_path)
ALTER FUNCTION public.update_updated_at()          SET search_path = public;
ALTER FUNCTION public.touch_updated_at()           SET search_path = public;
ALTER FUNCTION public.sync_customers_from_loads()  SET search_path = public;
