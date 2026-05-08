DO $$ BEGIN
  ALTER TABLE "screening_sessions" ADD COLUMN "state_snapshot" jsonb;
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;
-- For completed sessions that were created before this migration,
-- state_snapshot will be null. The loader should handle this gracefully.
