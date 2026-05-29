-- Add soft-delete columns to screening_routine_selections and replace the
-- hard unique constraint with a partial unique index (WHERE archived_at IS NULL).
-- This allows archived rows to coexist with new active rows for the same
-- (application_id, choice_effect_id) pair.

ALTER TABLE "screening_routine_selections"
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "archived_by" TEXT;

ALTER TABLE "screening_routine_selections"
  DROP CONSTRAINT IF EXISTS "screening_routine_selections_application_id_choice_effect_id_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "srs_active_unique_idx"
  ON "screening_routine_selections" ("application_id", "choice_effect_id")
  WHERE "archived_at" IS NULL;
