-- Ensure existing bucket objects are explicitly marked with source_type.
-- This backfills legacy rows that may predate source_type tracking.

ALTER TABLE "bucket_objects" ADD COLUMN IF NOT EXISTS "source_type" text;

UPDATE "bucket_objects"
SET "source_type" = 'manual'
WHERE "source_type" IS NULL;

ALTER TABLE "bucket_objects" ALTER COLUMN "source_type" SET DEFAULT 'manual';
ALTER TABLE "bucket_objects" ALTER COLUMN "source_type" SET NOT NULL;

ALTER TABLE "bucket_objects" DROP CONSTRAINT IF EXISTS "bucket_source_type_check";
ALTER TABLE "bucket_objects" ADD CONSTRAINT "bucket_source_type_check"
	CHECK ("source_type" IN ('manual', 'automated'));
