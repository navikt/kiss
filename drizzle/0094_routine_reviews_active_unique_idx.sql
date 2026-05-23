-- Partial unique indexes to enforce at DB level that at most one active
-- (draft/needs_follow_up) review exists per (routine, application) pair.
-- This prevents TOCTOU races where two concurrent requests both read
-- "no conflict" and both insert a new draft review.

-- Preflight data fix: discard older duplicate active reviews so the indexes
-- can be created on environments that previously allowed multiple active reviews.

-- App routines: keep the newest active review per (routine_id, application_id)
WITH duplicates AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY routine_id, application_id
               ORDER BY created_at DESC
           ) AS rn
    FROM routine_reviews
    WHERE status IN ('draft', 'needs_follow_up')
      AND application_id IS NOT NULL
)
UPDATE routine_reviews
SET status = 'discarded'
WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

-- Section routines (applicationId = null): keep the newest active review per routine_id
WITH duplicates AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY routine_id
               ORDER BY created_at DESC
           ) AS rn
    FROM routine_reviews
    WHERE status IN ('draft', 'needs_follow_up')
      AND application_id IS NULL
)
UPDATE routine_reviews
SET status = 'discarded'
WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

-- App routines: one active review per (routineId, applicationId)
CREATE UNIQUE INDEX IF NOT EXISTS routine_reviews_active_per_routine_app_idx
    ON routine_reviews (routine_id, application_id)
    WHERE status IN ('draft', 'needs_follow_up')
      AND application_id IS NOT NULL;

-- Section routines (applicationId = null): one active review per routineId
CREATE UNIQUE INDEX IF NOT EXISTS routine_reviews_active_section_routine_idx
    ON routine_reviews (routine_id)
    WHERE status IN ('draft', 'needs_follow_up')
      AND application_id IS NULL;
