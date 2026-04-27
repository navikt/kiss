-- Soft-delete (logisk arkivering) for `section_ignored_applications`.
--
-- Tidligere ble ignorerte applikasjoner hard-slettet via
-- `unignoreAppForSection()`, slik at vi mistet sporbarhet på hvilke
-- applikasjoner en seksjon har valgt å ignorere — inkludert hvem som
-- la dem til/fjernet dem og når. Dette er compliance-relevante data
-- (revisjonsbevis), så historikken må bevares.
--
-- Strategi:
--   1. Legg til `archived_at` / `archived_by` (idempotent IF NOT EXISTS).
--   2. Pre-flight dedup som sikkerhetsnett: tabellen hadde ingen UNIQUE,
--      så det kan finnes historiske duplikater. Behold eldste rad
--      (ignored_at ASC, id ASC tiebreaker), arkiver resten.
--   3. Drop ev. tidligere UNIQUE-constraint (i tilfelle den ble lagt til
--      i en parallell migrering — Drizzle har to navnevarianter).
--   4. Opprett en partiell unik indeks som kun gjelder aktive rader.
--      Dette lar arkiverte rader ligge igjen samtidig som en ny aktiv
--      rad kan legges til for samme (seksjon, applikasjon).
--
-- Idempotent via IF NOT EXISTS / IF EXISTS.

ALTER TABLE "section_ignored_applications"
	ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "archived_by" text;
--> statement-breakpoint

LOCK TABLE "section_ignored_applications" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint

WITH "duplicate_active_rows" AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "section_id", "application_id"
			ORDER BY "ignored_at" ASC, "id" ASC
		) AS "rn"
	FROM "section_ignored_applications"
	WHERE "archived_at" IS NULL
)
UPDATE "section_ignored_applications" AS "sia"
SET "archived_at" = NOW(), "archived_by" = 'migration-0055-dedupe'
FROM "duplicate_active_rows" AS "d"
WHERE "sia"."id" = "d"."id" AND "d"."rn" > 1;
--> statement-breakpoint

ALTER TABLE "section_ignored_applications"
	DROP CONSTRAINT IF EXISTS "section_ignored_applications_section_id_application_id_unique";
--> statement-breakpoint

ALTER TABLE "section_ignored_applications"
	DROP CONSTRAINT IF EXISTS "uq_section_ignored_application";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "section_ignored_applications_active_unique_idx"
	ON "section_ignored_applications" ("section_id", "application_id")
	WHERE "archived_at" IS NULL;
