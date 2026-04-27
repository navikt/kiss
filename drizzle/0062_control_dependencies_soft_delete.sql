-- Soft-delete (logisk arkivering) for `control_dependencies` (SD12d).
--
-- Tidligere ble kontroll-avhengigheter hard-slettet via
-- `removeControlDependency()`, slik at vi mistet sporbarhet på hvilke
-- kontroller som har vært erklært å avhenge av andre kontroller — inkludert
-- hvem som la til/fjernet koblingen og når. Dette er compliance-relevante
-- relasjoner i kontrollrammeverket og må bevares som historikk.
--
-- Strategi:
--   1. Legg til `archived_at` / `archived_by` (idempotent IF NOT EXISTS).
--   2. Pre-flight dedup som sikkerhetsnett. Tabellen har historisk hatt kun
--      PRIMARY KEY på `id` (ingen unique constraint på (control_id,
--      depends_on_control_id)), så det kan finnes duplikater i prod. Vi
--      arkiverer alle utenom én pr. logisk kobling (laveste id beholdes).
--   3. Drop ev. tidligere unique constraint (begge Drizzle-navngivnings-
--      varianter) for å være idempotent på tvers av miljøer.
--   4. Opprett partial unique index som kun gjelder aktive rader. Dette lar
--      arkiverte rader ligge igjen samtidig som en ny aktiv kobling kan
--      legges til for samme par (control_id, depends_on_control_id).
--
-- Idempotent via IF NOT EXISTS / IF EXISTS.

ALTER TABLE "control_dependencies"
	ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "archived_by" text;
--> statement-breakpoint

LOCK TABLE "control_dependencies" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint

WITH "duplicate_active_rows" AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "control_id", "depends_on_control_id"
			ORDER BY "id" ASC
		) AS "rn"
	FROM "control_dependencies"
	WHERE "archived_at" IS NULL
)
UPDATE "control_dependencies" AS "cd"
SET "archived_at" = NOW(), "archived_by" = 'migration-0062-dedupe'
FROM "duplicate_active_rows" AS "d"
WHERE "cd"."id" = "d"."id" AND "d"."rn" > 1;
--> statement-breakpoint

ALTER TABLE "control_dependencies"
	DROP CONSTRAINT IF EXISTS "control_dependencies_control_id_depends_on_control_id_unique";
--> statement-breakpoint

ALTER TABLE "control_dependencies"
	DROP CONSTRAINT IF EXISTS "control_dependencies_control_id_depends_on_control_id_key";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "control_dependencies_active_unique_idx"
	ON "control_dependencies" ("control_id", "depends_on_control_id")
	WHERE "archived_at" IS NULL;
