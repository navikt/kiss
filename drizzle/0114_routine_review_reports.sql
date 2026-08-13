-- Routine review reports: reports scoped to BOTH an application and a routine
-- need a second scope dimension in addition to the existing scope/scope_id pair.
ALTER TABLE "reports"
  ADD COLUMN IF NOT EXISTS "secondary_scope_id" UUID;
