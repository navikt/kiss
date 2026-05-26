ALTER TABLE "application_group_assessments"
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "archived_by" TEXT;

ALTER TABLE "application_group_assessments"
  DROP CONSTRAINT IF EXISTS "application_group_assessments_application_id_group_id_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "application_group_assessments_active_unique_idx"
  ON "application_group_assessments" ("application_id", "group_id")
  WHERE archived_at IS NULL;
