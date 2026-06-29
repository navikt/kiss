ALTER TABLE "application_environments" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
ALTER TABLE "application_environments" ADD COLUMN IF NOT EXISTS "archived_by" text;
