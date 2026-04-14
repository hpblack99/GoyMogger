/*
  # Create audit log table

  1. New Tables
    - `audit_logs`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to profiles)
      - `action` (text) - create, read, update, delete
      - `table_name` (text) - which table was affected
      - `record_id` (uuid) - which record was affected
      - `changes` (jsonb) - what changed (old values, new values)
      - `ip_address` (text)
      - `user_agent` (text)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on `audit_logs` table
    - Users can only read logs for their own actions
    - System inserts logs (not user-controlled)
*/

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  table_name text NOT NULL,
  record_id uuid,
  changes jsonb DEFAULT '{}',
  ip_address text,
  user_agent text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_table_name ON audit_logs(table_name);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own audit logs"
  ON audit_logs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "System can insert audit logs"
  ON audit_logs FOR INSERT
  WITH CHECK (true);
