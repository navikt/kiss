-- Oracle evidence integration in routine reviews.
-- Adds source_type tracking, oracle evidence downloads table, and force-fetch support.

-- 1. Add source_type to routine_review_attachments
ALTER TABLE "routine_review_attachments" ADD COLUMN IF NOT EXISTS "source_type" text NOT NULL DEFAULT 'manual';

-- 2. Add source_type to bucket_objects
ALTER TABLE "bucket_objects" ADD COLUMN IF NOT EXISTS "source_type" text NOT NULL DEFAULT 'manual';

-- 3. Create evidence downloads table for Oracle evidence review activities
CREATE TABLE IF NOT EXISTS "routine_review_evidence_downloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"activity_id" uuid NOT NULL REFERENCES "routine_review_activities" ("id") ON DELETE RESTRICT,
	"instance_id" text NOT NULL,
	"evidence_type" text NOT NULL,
	"format" text NOT NULL,
	"bucket_path" text NOT NULL,
	"file_name" text NOT NULL,
	"size_bytes" integer,
	"content_type" text NOT NULL,
	"source" text NOT NULL DEFAULT 'm2m_api',
	"collected_at" timestamp with time zone,
	"api_instance_name" text,
	"force_fetch_justification" text,
	"review_progress_snapshot" jsonb,
	"performed_by" text NOT NULL,
	"performed_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- 4. Constraints on evidence downloads
ALTER TABLE "routine_review_evidence_downloads" DROP CONSTRAINT IF EXISTS "evidence_download_source_check";
ALTER TABLE "routine_review_evidence_downloads" ADD CONSTRAINT "evidence_download_source_check"
	CHECK ("source" IN ('m2m_api', 'manual_upload'));

ALTER TABLE "routine_review_evidence_downloads" DROP CONSTRAINT IF EXISTS "evidence_download_type_check";
ALTER TABLE "routine_review_evidence_downloads" ADD CONSTRAINT "evidence_download_type_check"
	CHECK ("evidence_type" IN ('audit', 'profiles', 'roles', 'users', 'period'));

ALTER TABLE "routine_review_evidence_downloads" DROP CONSTRAINT IF EXISTS "evidence_download_format_check";
ALTER TABLE "routine_review_evidence_downloads" ADD CONSTRAINT "evidence_download_format_check"
	CHECK ("format" IN ('excel', 'pdf'));

-- 5. Constraints on source_type columns
ALTER TABLE "routine_review_attachments" DROP CONSTRAINT IF EXISTS "attachment_source_type_check";
ALTER TABLE "routine_review_attachments" ADD CONSTRAINT "attachment_source_type_check"
	CHECK ("source_type" IN ('manual', 'automated'));

ALTER TABLE "bucket_objects" DROP CONSTRAINT IF EXISTS "bucket_source_type_check";
ALTER TABLE "bucket_objects" ADD CONSTRAINT "bucket_source_type_check"
	CHECK ("source_type" IN ('manual', 'automated'));

-- 6. Index for efficient lookups by activity_id
CREATE INDEX IF NOT EXISTS "idx_evidence_downloads_activity_id" ON "routine_review_evidence_downloads" ("activity_id");
