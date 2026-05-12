-- Backfill bucket_objects for Oracle evidence downloads.
INSERT INTO "bucket_objects" (
	"bucket_name",
	"object_path",
	"content_type",
	"size_bytes",
	"object_type",
	"source_type",
	"uploaded_by",
	"uploaded_at",
	"metadata"
)
SELECT
	COALESCE((SELECT "bucket_name" FROM "bucket_objects" ORDER BY "uploaded_at" DESC LIMIT 1), 'kiss-data-local') AS "bucket_name",
	d."bucket_path",
	d."content_type",
	d."size_bytes",
	'oracle_evidence' AS "object_type",
	CASE d."source"
		WHEN 'manual_upload' THEN 'manual'
		ELSE 'automated'
	END AS "source_type",
	d."performed_by",
	d."performed_at",
	json_build_object(
		'activityId', d."activity_id",
		'evidenceDownloadId', d."id",
		'instanceId', d."instance_id",
		'evidenceType', d."evidence_type",
		'fileName', d."file_name"
	)::text AS "metadata"
FROM "routine_review_evidence_downloads" d
WHERE NOT EXISTS (
	SELECT 1
	FROM "bucket_objects" b
	WHERE b."object_path" = d."bucket_path"
);
