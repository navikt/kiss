-- Partial unique-indeks som hindrer at det opprettes to *aktive* persistens-rader
-- for samme (application_id, type, name)-tuple. Arkiverte rader (archived_at
-- IS NOT NULL) er bevisst utelatt slik at historikk kan ligge igjen ved siden
-- av en ny aktiv rad.
--
-- Dette stenger en TOCTOU-luke i `ensureOraclePersistenceEntries` der to
-- samtidige transaksjoner kunne ende opp med duplikat aktiv rad.
--
-- Preflight: arkiver eventuelle duplikater som måtte finnes fra historisk
-- TOCTOU, slik at CREATE UNIQUE INDEX ikke feiler i deploy. Beholder den
-- eldste aktive raden (laveste discovered_at, deretter ctid som tiebreaker)
-- og arkiverer resten med `archived_by = 'migration-0049-dedupe'` for
-- sporbarhet i audit-rapporter.
--
-- Idempotent via IF NOT EXISTS.

LOCK TABLE "application_persistence" IN SHARE ROW EXCLUSIVE MODE;

WITH "duplicate_active_rows" AS (
	SELECT
		ctid,
		row_number() OVER (
			PARTITION BY "application_id", "type", "name"
			ORDER BY "discovered_at" ASC, ctid ASC
		) AS "rn"
	FROM "application_persistence"
	WHERE "archived_at" IS NULL
)
UPDATE "application_persistence" AS "ap"
SET "archived_at" = NOW(), "archived_by" = 'migration-0049-dedupe'
FROM "duplicate_active_rows" AS "d"
WHERE "ap".ctid = "d".ctid AND "d"."rn" > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "application_persistence_active_unique_idx"
	ON "application_persistence" ("application_id", "type", "name")
	WHERE "archived_at" IS NULL;

