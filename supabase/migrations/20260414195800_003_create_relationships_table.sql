/*
  # Create relationships table

  1. New Tables
    - `relationships`
      - `id` (uuid, primary key)
      - `source_id` (uuid, foreign key to items)
      - `target_id` (uuid, foreign key to items)
      - `type` (text) - relationship type (e.g., "related", "parent", "child", "reference")
      - `metadata` (jsonb) - flexible storage for relationship-specific data
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on `relationships` table
    - Users can read relationships between public items or items they own
    - Users can create/update/delete relationships for their own items
*/

CREATE TABLE IF NOT EXISTS relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  type text DEFAULT 'related',
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  CONSTRAINT different_items CHECK (source_id != target_id)
);

CREATE INDEX idx_relationships_source ON relationships(source_id);
CREATE INDEX idx_relationships_target ON relationships(target_id);
CREATE INDEX idx_relationships_type ON relationships(type);

ALTER TABLE relationships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view relationships for items they own or are public"
  ON relationships FOR SELECT
  USING (
    (EXISTS (SELECT 1 FROM items WHERE id = source_id AND (is_public = true OR user_id = auth.uid())))
    OR
    (auth.uid() IN (SELECT user_id FROM items WHERE id = source_id))
  );

CREATE POLICY "Users can create relationships for their own items"
  ON relationships FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM items WHERE id = source_id AND user_id = auth.uid())
  );

CREATE POLICY "Users can update relationships for their own items"
  ON relationships FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM items WHERE id = source_id AND user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM items WHERE id = source_id AND user_id = auth.uid())
  );

CREATE POLICY "Users can delete relationships for their own items"
  ON relationships FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM items WHERE id = source_id AND user_id = auth.uid())
  );
