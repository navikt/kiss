-- Soft-delete (logisk arkivering) for `entra_group_classifications`.
--
-- Tidligere ble klassifiseringer hard-slettet via `deleteGroupClassification()`,
-- slik at vi mistet sporbarhet på hvilke klassifiseringer en Entra-gruppe har
-- hatt — inkludert hvem som la dem til/fjernet dem og når. Dette er
-- compliance-relevante data (revisjonsbevis), så historikken må bevares.
--
-- Strategi:
--   1. Legg til `archived_at` / `archived_by` (idempotent IF NOT EXISTS).
--   2. Pre-flight dedup som sikkerhetsnett (skal ikke finnes pga. eksisterende
--      UNIQUE-constraint på group_id, men sikrer at den partielle indeksen
--      ikke feiler i deploy hvis det finnes historiske duplikater).
--   3. Drop UNIQUE(group_id) (`entra_group_classifications_group_id_unique` /
--      `entra_group_classifications_group_id_key`) og erstatt med en partiell
--      unik indeks som kun gjelder aktive rader. Dette lar arkiverte rader
--      ligge igjen samtidig som en ny aktiv rad kan legges til for samme
--      gruppe-id.
--
-- Idempotent via IF NOT EXISTS / IF EXISTS.

ALTER TABLE "entra_group_classifications"
	ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "archived_by" text;
--> statement-breakpoint

LOCK TABLE "entra_group_classifications" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint

WITH "duplicate_active_rows" AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "group_id"
			ORDER BY "created_at" ASC, "id" ASC
		) AS "rn"
	FROM "entra_group_classifications"
	WHERE "archived_at" IS NULL
)
UPDATE "entra_group_classifications" AS "egc"
SET "archived_at" = NOW(), "archived_by" = 'migration-0054-dedupe'
FROM "duplicate_active_rows" AS "d"
WHERE "egc"."id" = "d"."id" AND "d"."rn" > 1;
--> statement-breakpoint

ALTER TABLE "entra_group_classifications"
	DROP CONSTRAINT IF EXISTS "entra_group_classifications_group_id_unique";
--> statement-breakpoint

ALTER TABLE "entra_group_classifications"
	DROP CONSTRAINT IF EXISTS "entra_group_classifications_group_id_key";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "entra_group_classifications_active_unique_idx"
	ON "entra_group_classifications" ("group_id")
	WHERE "archived_at" IS NULL;
