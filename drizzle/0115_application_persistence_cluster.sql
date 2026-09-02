ALTER TABLE "application_persistence" ADD COLUMN IF NOT EXISTS "cluster" text;
DROP INDEX IF EXISTS "application_persistence_active_unique_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "application_persistence_active_unique_idx" ON "application_persistence" ("application_id", "type", "name", (COALESCE("cluster", ''))) WHERE archived_at IS NULL;
