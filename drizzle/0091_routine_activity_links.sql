-- Ny tabell for å koble flere vedlikeholdsaktiviteter til en rutine.
-- Erstatter routines.activity_type (én-til-én) med en mange-til-mange-relasjon
-- som støtter rekkefølge via sort_order.

CREATE TABLE IF NOT EXISTS "routine_activity_links" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  routine_id UUID NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL,
  archived_at TIMESTAMPTZ,
  archived_by TEXT
);

-- Hver rutine kan kun ha én aktiv kobling per aktivitetstype
CREATE UNIQUE INDEX IF NOT EXISTS routine_activity_links_active_unique_idx
  ON routine_activity_links (routine_id, activity_type)
  WHERE archived_at IS NULL;

-- Indeks for effektiv lookup per rutine
CREATE INDEX IF NOT EXISTS routine_activity_links_routine_idx
  ON routine_activity_links (routine_id)
  WHERE archived_at IS NULL;

-- Migrér eksisterende data fra routines.activity_type (inkludert arkiverte rutiner)
INSERT INTO routine_activity_links (routine_id, activity_type, sort_order, created_by)
SELECT id, activity_type, 0, COALESCE(created_by, 'migration')
FROM routines
WHERE activity_type IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM routine_activity_links ral
    WHERE ral.routine_id = routines.id
      AND ral.activity_type = routines.activity_type
      AND ral.archived_at IS NULL
  )
ON CONFLICT DO NOTHING;

-- Add sort_order to routine_review_activities for deterministic ordering
ALTER TABLE "routine_review_activities" ADD COLUMN IF NOT EXISTS "sort_order" integer NOT NULL DEFAULT 0;

-- Fjern eventuelle duplikater i routine_review_activities før unik constraint.
-- Beholder raden med mest data: completed > has config/snapshot > newest.
-- Først: flytt eventuelle evidence downloads fra duplikater til overlevende rad.
UPDATE routine_review_evidence_downloads ed
SET activity_id = survivor.id
FROM routine_review_activities a
JOIN LATERAL (
  SELECT b.id FROM routine_review_activities b
  WHERE b.review_id = a.review_id AND b.type = a.type
  ORDER BY
    (CASE WHEN b.status = 'completed' THEN 1 ELSE 0 END) DESC,
    (CASE WHEN b.snapshot_before IS NOT NULL OR b.snapshot_after IS NOT NULL THEN 1 ELSE 0 END) DESC,
    (CASE WHEN b.provider_config IS NOT NULL THEN 1 ELSE 0 END) DESC,
    (CASE WHEN b.period_config IS NOT NULL THEN 1 ELSE 0 END) DESC,
    b.created_at DESC, b.id DESC
  LIMIT 1
) survivor ON true
WHERE ed.activity_id = a.id
  AND a.id != survivor.id;

-- Flytt eventuelle entra changes fra duplikater til overlevende rad.
UPDATE routine_review_activity_entra_changes ec
SET activity_id = survivor.id
FROM routine_review_activities a
JOIN LATERAL (
  SELECT b.id FROM routine_review_activities b
  WHERE b.review_id = a.review_id AND b.type = a.type
  ORDER BY
    (CASE WHEN b.status = 'completed' THEN 1 ELSE 0 END) DESC,
    (CASE WHEN b.snapshot_before IS NOT NULL OR b.snapshot_after IS NOT NULL THEN 1 ELSE 0 END) DESC,
    (CASE WHEN b.provider_config IS NOT NULL THEN 1 ELSE 0 END) DESC,
    (CASE WHEN b.period_config IS NOT NULL THEN 1 ELSE 0 END) DESC,
    b.created_at DESC, b.id DESC
  LIMIT 1
) survivor ON true
WHERE ec.activity_id = a.id
  AND a.id != survivor.id;

-- Slett alle duplikater (alle rader som IKKE er survivor for sin (review_id, type))
DELETE FROM routine_review_activities a
WHERE a.id != (
  SELECT c.id FROM routine_review_activities c
  WHERE c.review_id = a.review_id AND c.type = a.type
  ORDER BY
    (CASE WHEN c.status = 'completed' THEN 1 ELSE 0 END) DESC,
    (CASE WHEN c.snapshot_before IS NOT NULL OR c.snapshot_after IS NOT NULL THEN 1 ELSE 0 END) DESC,
    (CASE WHEN c.provider_config IS NOT NULL THEN 1 ELSE 0 END) DESC,
    (CASE WHEN c.period_config IS NOT NULL THEN 1 ELSE 0 END) DESC,
    c.created_at DESC, c.id DESC
  LIMIT 1
)
AND EXISTS (
  SELECT 1 FROM routine_review_activities d
  WHERE d.review_id = a.review_id AND d.type = a.type AND d.id != a.id
);

-- Unik constraint på routine_review_activities for å forhindre dupliserte
-- aktiviteter per gjennomgang ved race conditions (multi-pod)
CREATE UNIQUE INDEX IF NOT EXISTS review_activities_review_type_unique_idx
  ON routine_review_activities (review_id, type);
