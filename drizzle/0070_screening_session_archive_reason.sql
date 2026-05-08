DO $$ BEGIN
  ALTER TABLE "screening_sessions" ADD COLUMN "archive_reason" text;
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;
