-- Logisk arkivering (soft-delete) for dev_team_nais_team_mappings (SD11b).
--
-- Bakgrunn: SD7 (0050) innførte archived_at/archived_by på 13 m:n-linktabeller,
-- men dev_team_nais_team_mappings ble ikke inkludert. Denne migrasjonen lukker
-- gapet slik at koblinger mellom Nav-utviklingsteam og Nais-team også bevares
-- som historikk fremfor å hard-slettes.
--
-- Strategi for re-link: ved ny kobling etter unlink soft-deletes ikke den gamle
-- raden, og en ny aktiv rad opprettes. Partial unique index (WHERE
-- archived_at IS NULL) sikrer at det aldri kan finnes to aktive rader for
-- samme (dev_team_id, nais_team_id) samtidig — men ubegrenset antall arkiverte
-- historikk-rader er tillatt.
--
-- Idempotent via IF NOT EXISTS / IF EXISTS.

ALTER TABLE "dev_team_nais_team_mappings"
	ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "archived_by" text;
--> statement-breakpoint

-- LOCK TABLE for å hindre concurrent inserts i vinduet mellom dedup og
-- index-opprettelse (samme mønster som 0050 for control_technology_elements
-- og application_team_mappings).
LOCK TABLE "dev_team_nais_team_mappings" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint

-- Defensiv dedup: arkiverer eventuelle dupliserte aktive rader (beholder den
-- med lavest id som tiebreaker for stabilitet på tvers av runs).
WITH ranked AS (
	SELECT id, ROW_NUMBER() OVER (
		PARTITION BY dev_team_id, nais_team_id ORDER BY id
	) AS rn
	FROM dev_team_nais_team_mappings
	WHERE archived_at IS NULL
)
UPDATE dev_team_nais_team_mappings
SET archived_at = now(), archived_by = 'system:sd11b-dedup'
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
--> statement-breakpoint

-- Slipp eventuell tidligere unique-constraint (begge Drizzle-navnevarianter)
-- før partial unique index opprettes. Tabellen har historisk ikke hatt en
-- unique-constraint, men dette er forsvar i dybden.
ALTER TABLE "dev_team_nais_team_mappings"
	DROP CONSTRAINT IF EXISTS "dev_team_nais_team_mappings_dev_team_id_nais_team_id_unique";
--> statement-breakpoint

ALTER TABLE "dev_team_nais_team_mappings"
	DROP CONSTRAINT IF EXISTS "uq_dev_team_nais_team_mapping";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_dev_team_nais_team_mapping_active"
	ON "dev_team_nais_team_mappings" ("dev_team_id", "nais_team_id")
	WHERE "archived_at" IS NULL;
--> statement-breakpoint

-- Endre FK nais_team_id fra CASCADE til RESTRICT for å bevare arkiverte
-- koblinger selv om et nais-team fjernes. Dekker begge Drizzle-navnevarianter.
ALTER TABLE "dev_team_nais_team_mappings"
DROP CONSTRAINT IF EXISTS "dev_team_nais_team_mappings_nais_team_id_nais_teams_id_fk";
--> statement-breakpoint

ALTER TABLE "dev_team_nais_team_mappings"
DROP CONSTRAINT IF EXISTS "dev_team_nais_team_mappings_nais_team_id_fk";
--> statement-breakpoint

ALTER TABLE "dev_team_nais_team_mappings"
ADD CONSTRAINT "dev_team_nais_team_mappings_nais_team_id_nais_teams_id_fk"
FOREIGN KEY ("nais_team_id") REFERENCES "public"."nais_teams"("id")
ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint

ALTER TABLE "dev_team_nais_team_mappings"
VALIDATE CONSTRAINT "dev_team_nais_team_mappings_nais_team_id_nais_teams_id_fk";
