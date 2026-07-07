-- Surface FreshX bulk-quote failures on the job so the UI can explain
-- why freshx_rate columns are empty instead of failing silently.
ALTER TABLE quote_jobs ADD COLUMN IF NOT EXISTS freshx_error text;
