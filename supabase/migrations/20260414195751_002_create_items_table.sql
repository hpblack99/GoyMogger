/*
  # Create items table

  1. New Tables
    - `items`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to profiles)
      - `title` (text)
      - `description` (text)
      - `content` (text)
      - `status` (text) - draft, published, archived
      - `is_public` (boolean) - visibility control
      - `tags` (text array) - for filtering and organization
      - `metadata` (jsonb) - flexible storage for custom data
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `items` table
    - Users can read public items
    - Users can read/update/delete their own items
*/

CREATE TABLE IF NOT EXISTS items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  content text,
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  is_public boolean DEFAULT false,
  tags text[] DEFAULT '{}',
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_items_user_id ON items(user_id);
CREATE INDEX idx_items_status ON items(status);
CREATE INDEX idx_items_created_at ON items(created_at DESC);

ALTER TABLE items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public items are readable by all"
  ON items FOR SELECT
  USING (is_public = true OR auth.uid() = user_id);

CREATE POLICY "Users can create items"
  ON items FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own items"
  ON items FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own items"
  ON items FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
