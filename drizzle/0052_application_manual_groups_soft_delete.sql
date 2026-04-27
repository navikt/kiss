-- Soft-delete (logisk arkivering) for `application_manual_groups`.
--
-- Tidligere ble manuelle grupper hard-slettet via `removeManualGroup()`. Det
-- førte til at vi mistet sporbarhet på hvilke grupper en applikasjon har vært
-- klassifisert med, og hvem som la til/fjernet dem. Med soft-delete bevarer vi
-- hele historikken side om side med audit_log-oppføringene.
--
-- Strategi:
--   1. Legg til `archived_at` / `archived_by` (idempotent IF NOT EXISTS).
--   2. Pre-flight dedup: arkiver eventuelle duplikater (skal ikke finnes pga.
--      eksisterende UNIQUE-constraint, men forsiktighetshensyn slik at den
--      partielle indeksen ikke feiler i deploy).
--   3. Drop den eksisterende UNIQUE(application_id, group_id)-constrainten og
--      erstatt med en partiell unik indeks som kun gjelder aktive rader. Dette
--      lar arkiverte rader ligge igjen samtidig som en ny aktiv rad kan legges
--      til for samme (applikasjon, gruppe).
--
-- Idempotent via IF NOT EXISTS / IF EXISTS.

ALTER TABLE "application_manual_groups"
	ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "archived_by" text;
--> statement-breakpoint

LOCK TABLE "application_manual_groups" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint

WITH "duplicate_active_rows" AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "application_id", "group_id"
			ORDER BY "created_at" ASC, "id" ASC
		) AS "rn"
	FROM "application_manual_groups"
	WHERE "archived_at" IS NULL
)
UPDATE "application_manual_groups" AS "amg"
SET "archived_at" = NOW(), "archived_by" = 'migration-0052-dedupe'
FROM "duplicate_active_rows" AS "d"
WHERE "amg"."id" = "d"."id" AND "d"."rn" > 1;
--> statement-breakpoint

ALTER TABLE "application_manual_groups"
	DROP CONSTRAINT IF EXISTS "application_manual_groups_application_id_group_id_unique";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "application_manual_groups_active_unique_idx"
	ON "application_manual_groups" ("application_id", "group_id")
	WHERE "archived_at" IS NULL;
