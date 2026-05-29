-- Add priority tracking to routines
-- Priority: 1=Kritisk, 2=Høy, 3=Normal (default)

ALTER TABLE routines 
  ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 3;

ALTER TABLE routines 
  ADD COLUMN IF NOT EXISTS priority_updated_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE routines 
  ADD COLUMN IF NOT EXISTS priority_updated_by TEXT;

-- Ensure priority is always 1 (Kritisk), 2 (Høy), or 3 (Normal)
ALTER TABLE routines DROP CONSTRAINT IF EXISTS routines_priority_check;
ALTER TABLE routines ADD CONSTRAINT routines_priority_check CHECK (priority BETWEEN 1 AND 3);

-- Index for efficient sorting by priority in routine lists
CREATE INDEX IF NOT EXISTS routines_priority_idx 
  ON routines (priority) 
  WHERE archived_at IS NULL;
