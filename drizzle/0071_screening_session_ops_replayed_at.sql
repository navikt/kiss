DO $$ BEGIN
  ALTER TABLE "screening_session_operations" ADD COLUMN "replayed_at" timestamp with time zone;
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;
