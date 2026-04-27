-- Soft-delete (logisk arkivering) og audit-konsistens for `nais_discovered_apps`.
--
-- Tidligere ble oppdagede Nais-applikasjoner hard-slettet og re-insertert ved
-- hver synk via `syncDiscoveredApps()`. Det betød at sporbarhet for når en app
-- forsvant fra et team (f.eks. som følge av sletting i Nais Console) gikk
-- tapt, og at vi ikke kunne skille mellom "har aldri eksistert" og "ble
-- arkivert som følge av synk". Med soft-delete bevares historikken side om
-- side med `audit_log`-oppføringene.
--
-- Strategi:
--   1. Legg til `archived_at` / `archived_by` (idempotent IF NOT EXISTS).
--   2. Pre-flight dedup: arkiver eventuelle aktive duplikater (skal ikke
--      finnes pga. eksisterende UNIQUE-indeks, men sikrer at den nye partielle
--      indeksen ikke feiler i deploy hvis det finnes historiske duplikater).
--   3. Drop den eksisterende UNIQUE-indeksen `nais_discovered_apps_name_team_idx`
--      og erstatt med en partiell unik indeks som kun gjelder aktive rader.
--      Dette lar arkiverte rader ligge igjen samtidig som en ny aktiv rad kan
--      legges til for samme (navn, team) når en app re-oppdages etter å ha
--      vært arkivert.
--
-- Idempotent via IF NOT EXISTS / IF EXISTS.

ALTER TABLE "nais_discovered_apps"
	ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "archived_by" text;
--> statement-breakpoint

LOCK TABLE "nais_discovered_apps" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint

WITH "duplicate_active_rows" AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "name", "nais_team_id"
			ORDER BY "discovered_at" ASC, "id" ASC
		) AS "rn"
	FROM "nais_discovered_apps"
	WHERE "archived_at" IS NULL
)
UPDATE "nais_discovered_apps" AS "nda"
SET "archived_at" = NOW(), "archived_by" = 'migration-0059-dedupe'
FROM "duplicate_active_rows" AS "d"
WHERE "nda"."id" = "d"."id" AND "d"."rn" > 1;
--> statement-breakpoint

DROP INDEX IF EXISTS "nais_discovered_apps_name_team_idx";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "nais_discovered_apps_active_unique_idx"
	ON "nais_discovered_apps" ("name", "nais_team_id")
	WHERE "archived_at" IS NULL;
