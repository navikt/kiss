-- Generalize routine_review_evidence_downloads from Oracle-specific to
-- provider-agnostic design. Uses ALTER TABLE to preserve existing data.

-- 1. Add new generic columns
ALTER TABLE "routine_review_evidence_downloads" ADD COLUMN IF NOT EXISTS
	"bucket_object_id" uuid REFERENCES "bucket_objects" ("id") ON DELETE RESTRICT;

ALTER TABLE "routine_review_evidence_downloads" ADD COLUMN IF NOT EXISTS
	"provider_type" text;

ALTER TABLE "routine_review_evidence_downloads" ADD COLUMN IF NOT EXISTS
	"provider_metadata" jsonb;

-- 2. Backfill bucket_object_id for existing rows (if any).
-- Creates a bucket_objects entry for each orphaned evidence download, using
-- its bucket_path, content_type and size_bytes before those columns are dropped.
-- Idempotent: only processes rows where bucket_object_id IS NULL.
DO $$ DECLARE
	rec RECORD;
	new_bo_id uuid;
BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_name = 'routine_review_evidence_downloads' AND column_name = 'bucket_path'
	) THEN
		FOR rec IN
			SELECT id, bucket_path, content_type, size_bytes, performed_by, performed_at,
				CASE WHEN source = 'manual_upload' THEN 'manual' ELSE 'automated' END AS derived_source_type
			FROM routine_review_evidence_downloads
			WHERE bucket_object_id IS NULL
		LOOP
			INSERT INTO bucket_objects (bucket_name, object_path, content_type, size_bytes, object_type, source_type, uploaded_by, uploaded_at)
			VALUES (
				COALESCE(
					(SELECT bucket_name FROM bucket_objects LIMIT 1),
					'kiss-data-local'
				),
				rec.bucket_path,
				rec.content_type,
				rec.size_bytes,
				'oracle_evidence',
				rec.derived_source_type,
				rec.performed_by,
				rec.performed_at
			)
			RETURNING id INTO new_bo_id;

			UPDATE routine_review_evidence_downloads
			SET bucket_object_id = new_bo_id
			WHERE id = rec.id;
		END LOOP;
	END IF;
END $$;

-- 3. Migrate existing rows (if any) from Oracle-specific columns to generic columns
-- Wrapped in DO block for idempotency: columns may already be dropped on re-run
DO $$ BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_name = 'routine_review_evidence_downloads' AND column_name = 'instance_id'
	) THEN
		UPDATE "routine_review_evidence_downloads"
		SET
			"provider_type" = 'oracle',
			"provider_metadata" = jsonb_build_object(
				'instanceId', "instance_id",
				'evidenceType', "evidence_type",
				'apiInstanceName', "api_instance_name",
				'reviewProgressSnapshot', "review_progress_snapshot"
			)
		WHERE "provider_type" IS NULL;
	END IF;
END $$;

-- 4. Set NOT NULL now that all rows have values (idempotent: no-op if already NOT NULL)
DO $$ BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_name = 'routine_review_evidence_downloads'
		AND column_name = 'bucket_object_id' AND is_nullable = 'YES'
	) THEN
		ALTER TABLE "routine_review_evidence_downloads" ALTER COLUMN "bucket_object_id" SET NOT NULL;
	END IF;
	IF EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_name = 'routine_review_evidence_downloads'
		AND column_name = 'provider_type' AND is_nullable = 'YES'
	) THEN
		ALTER TABLE "routine_review_evidence_downloads" ALTER COLUMN "provider_type" SET NOT NULL;
	END IF;
	IF EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_name = 'routine_review_evidence_downloads'
		AND column_name = 'provider_metadata' AND is_nullable = 'YES'
	) THEN
		ALTER TABLE "routine_review_evidence_downloads" ALTER COLUMN "provider_metadata" SET NOT NULL;
	END IF;
END $$;

-- 5. Drop Oracle-specific columns
ALTER TABLE "routine_review_evidence_downloads" DROP COLUMN IF EXISTS "instance_id";
ALTER TABLE "routine_review_evidence_downloads" DROP COLUMN IF EXISTS "evidence_type";
ALTER TABLE "routine_review_evidence_downloads" DROP COLUMN IF EXISTS "api_instance_name";
ALTER TABLE "routine_review_evidence_downloads" DROP COLUMN IF EXISTS "review_progress_snapshot";

-- 6. Drop columns now redundant with bucket_objects FK
ALTER TABLE "routine_review_evidence_downloads" DROP COLUMN IF EXISTS "bucket_path";
ALTER TABLE "routine_review_evidence_downloads" DROP COLUMN IF EXISTS "size_bytes";
ALTER TABLE "routine_review_evidence_downloads" DROP COLUMN IF EXISTS "content_type";

-- 7. Drop obsolete constraint (evidence_type values no longer a direct column)
ALTER TABLE "routine_review_evidence_downloads" DROP CONSTRAINT IF EXISTS "evidence_download_type_check";

-- 8. Add new constraints
ALTER TABLE "routine_review_evidence_downloads" DROP CONSTRAINT IF EXISTS "evidence_provider_type_check";
ALTER TABLE "routine_review_evidence_downloads" ADD CONSTRAINT "evidence_provider_type_check"
	CHECK ("provider_type" IN ('oracle', 'deployments'));

-- 9. Index for bucket_object_id lookups
CREATE INDEX IF NOT EXISTS "idx_evidence_downloads_bucket_object_id"
	ON "routine_review_evidence_downloads" ("bucket_object_id");
