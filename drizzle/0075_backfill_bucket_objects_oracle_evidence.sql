-- Generalize Oracle-specific evidence downloads to provider-backed downloads.
-- No production data exists in this table, so we recreate it with the new schema.

ALTER TABLE IF EXISTS "routine_review_evidence_downloads" DROP CONSTRAINT IF EXISTS "evidence_download_source_check";
ALTER TABLE IF EXISTS "routine_review_evidence_downloads" DROP CONSTRAINT IF EXISTS "evidence_download_type_check";
ALTER TABLE IF EXISTS "routine_review_evidence_downloads" DROP CONSTRAINT IF EXISTS "evidence_download_format_check";
ALTER TABLE IF EXISTS "routine_review_evidence_downloads" DROP CONSTRAINT IF EXISTS "evidence_provider_type_check";

DROP TABLE IF EXISTS "routine_review_evidence_downloads";

CREATE TABLE IF NOT EXISTS "routine_review_evidence_downloads" (
"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
"activity_id" uuid NOT NULL,
"bucket_object_id" uuid NOT NULL,
"provider_type" text NOT NULL,
"provider_metadata" jsonb NOT NULL,
"format" text NOT NULL,
"file_name" text NOT NULL,
"source" text NOT NULL DEFAULT 'm2m_api',
"collected_at" timestamp with time zone,
"force_fetch_justification" text,
"performed_by" text NOT NULL,
"performed_at" timestamp with time zone NOT NULL DEFAULT now(),
CONSTRAINT "routine_review_evidence_downloads_activity_id_fkey"
FOREIGN KEY ("activity_id") REFERENCES "routine_review_activities" ("id") ON DELETE RESTRICT,
CONSTRAINT "routine_review_evidence_downloads_bucket_object_id_fkey"
FOREIGN KEY ("bucket_object_id") REFERENCES "bucket_objects" ("id") ON DELETE RESTRICT
);

ALTER TABLE "routine_review_evidence_downloads" DROP CONSTRAINT IF EXISTS "evidence_download_source_check";
ALTER TABLE "routine_review_evidence_downloads" ADD CONSTRAINT "evidence_download_source_check"
CHECK ("source" IN ('m2m_api', 'manual_upload'));

ALTER TABLE "routine_review_evidence_downloads" DROP CONSTRAINT IF EXISTS "evidence_provider_type_check";
ALTER TABLE "routine_review_evidence_downloads" ADD CONSTRAINT "evidence_provider_type_check"
CHECK ("provider_type" IN ('oracle', 'deployments'));

ALTER TABLE "routine_review_evidence_downloads" DROP CONSTRAINT IF EXISTS "evidence_download_format_check";
ALTER TABLE "routine_review_evidence_downloads" ADD CONSTRAINT "evidence_download_format_check"
CHECK ("format" IN ('excel', 'pdf'));

CREATE INDEX IF NOT EXISTS "idx_evidence_downloads_activity_id"
ON "routine_review_evidence_downloads" ("activity_id");

CREATE INDEX IF NOT EXISTS "idx_evidence_downloads_bucket_object_id"
ON "routine_review_evidence_downloads" ("bucket_object_id");
