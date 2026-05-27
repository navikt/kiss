-- Backfill routine_activity_links for routines that have activity_type set
-- but no active link for that specific activity_type yet.
-- Uses the same NOT EXISTS logic as migration 0091 (matches on both routine_id AND activity_type)
-- to avoid skipping routines that have active links for a *different* activity type.
-- sort_order is set to max(existing active sort_order)+1 to append after existing links
-- and avoid duplicate sort_order values (which make ordering nondeterministic).
-- Includes archived routines to preserve historical activity data.
INSERT INTO routine_activity_links (id, routine_id, activity_type, sort_order, created_at, created_by)
SELECT
	gen_random_uuid(),
	r.id,
	r.activity_type,
	COALESCE(
		(SELECT MAX(ral2.sort_order) + 1
		 FROM routine_activity_links ral2
		 WHERE ral2.routine_id = r.id AND ral2.archived_at IS NULL),
		0
	),
	r.created_at,
	r.created_by
FROM routines r
WHERE r.activity_type IS NOT NULL
  AND NOT EXISTS (
	  SELECT 1
	  FROM routine_activity_links ral
	  WHERE ral.routine_id = r.id
	    AND ral.activity_type = r.activity_type
	    AND ral.archived_at IS NULL
  )
ON CONFLICT DO NOTHING;

-- Drop the now-redundant legacy column
ALTER TABLE "routines" DROP COLUMN IF EXISTS "activity_type";
