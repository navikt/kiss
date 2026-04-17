ALTER TABLE "routines" ADD COLUMN "approved_by" text;
ALTER TABLE "routines" ADD COLUMN "approved_at" timestamp with time zone;
ALTER TABLE "routines" ADD COLUMN "source_routine_id" uuid;
ALTER TABLE "routines" ADD COLUMN "replaced_by_routine_id" uuid;
ALTER TABLE "routines" ADD COLUMN "replaced_at" timestamp with time zone;
