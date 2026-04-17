ALTER TABLE "routines" ADD COLUMN IF NOT EXISTS "approved_by" text;
ALTER TABLE "routines" ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone;
ALTER TABLE "routines" ADD COLUMN IF NOT EXISTS "source_routine_id" uuid;
ALTER TABLE "routines" ADD COLUMN IF NOT EXISTS "replaced_by_routine_id" uuid;
ALTER TABLE "routines" ADD COLUMN IF NOT EXISTS "replaced_at" timestamp with time zone;
