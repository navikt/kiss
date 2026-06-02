ALTER TABLE application_persistence ADD COLUMN IF NOT EXISTS last_seen_in_nais_at TIMESTAMPTZ DEFAULT NOW();
