ALTER TABLE "routines" ADD COLUMN IF NOT EXISTS "is_section_routine" integer DEFAULT 0 NOT NULL;
ALTER TABLE "routines" ADD COLUMN IF NOT EXISTS "section_routine_owner_role" text;
