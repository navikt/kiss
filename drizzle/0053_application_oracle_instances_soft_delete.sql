-- Soft-delete (logisk arkivering) for `application_oracle_instances`.
--
-- Tidligere ble Oracle-instanser hard-slettet via `removeOracleInstance()`,
-- slik at vi mistet sporbarhet på hvilke instanser en applikasjon har vært
-- konfigurert med — inkludert hvem som la dem til/fjernet dem og når. Dette
-- er compliance-relevante data (revisjonsbevis), så historikken må bevares.
--
-- Strategi:
--   1. Legg til `archived_at` / `archived_by` (idempotent IF NOT EXISTS).
--   2. Pre-flight dedup som sikkerhetsnett (skal ikke finnes pga. eksisterende
--      UNIQUE-constraint, men sikrer at den partielle indeksen ikke feiler i
--      deploy hvis det finnes historiske duplikater).
--   3. Drop UNIQUE(application_id, instance_id) (`uq_application_oracle_instance`)
--      og erstatt med en partiell unik indeks som kun gjelder aktive rader.
--      Dette lar arkiverte rader ligge igjen samtidig som en ny aktiv rad kan
--      legges til for samme (applikasjon, instans).
--
-- Idempotent via IF NOT EXISTS / IF EXISTS.

ALTER TABLE "application_oracle_instances"
	ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "archived_by" text;
--> statement-breakpoint

LOCK TABLE "application_oracle_instances" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint

WITH "duplicate_active_rows" AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "application_id", "instance_id"
			ORDER BY "configured_at" ASC, "id" ASC
		) AS "rn"
	FROM "application_oracle_instances"
	WHERE "archived_at" IS NULL
)
UPDATE "application_oracle_instances" AS "aoi"
SET "archived_at" = NOW(), "archived_by" = 'migration-0053-dedupe'
FROM "duplicate_active_rows" AS "d"
WHERE "aoi"."id" = "d"."id" AND "d"."rn" > 1;
--> statement-breakpoint

ALTER TABLE "application_oracle_instances"
	DROP CONSTRAINT IF EXISTS "uq_application_oracle_instance";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "application_oracle_instances_active_unique_idx"
	ON "application_oracle_instances" ("application_id", "instance_id")
	WHERE "archived_at" IS NULL;
