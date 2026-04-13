-- Create the routine_persistence_links join table
CREATE TABLE IF NOT EXISTS "routine_persistence_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"routine_id" uuid NOT NULL REFERENCES "routines"("id") ON DELETE CASCADE,
	"persistence_type" text,
	"data_classification" text
);

-- Migrate existing data from single columns to the new table
INSERT INTO "routine_persistence_links" ("routine_id", "persistence_type", "data_classification")
SELECT "id", "persistence_type", "data_classification"
FROM "routines"
WHERE "persistence_type" IS NOT NULL OR "data_classification" IS NOT NULL;

-- Drop the old single-value columns from routines
ALTER TABLE "routines" DROP COLUMN IF EXISTS "persistence_type";
ALTER TABLE "routines" DROP COLUMN IF EXISTS "data_classification";
