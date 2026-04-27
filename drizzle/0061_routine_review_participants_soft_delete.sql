-- Soft-delete (logisk arkivering) for `routine_review_participants` (SD12c).
--
-- Tidligere ble deltakere på en rutinegjennomgang hard-slettet i
-- `updateReview()` (delete-and-replace) når deltakerlisten ble endret.
-- Det betød at vi mistet sporbarhet på hvem som ble lagt til/fjernet og når,
-- noe som er compliance-relevant (revisjonsbevis for hvem som deltok i
-- gjennomgangen). Denne migrasjonen innfører `archived_at`/`archived_by`
-- og en partiell unik indeks på (review_id, user_ident) for kun aktive
-- rader, slik at samme deltaker kan re-legges-til etter arkivering uten
-- konflikt.
--
-- Strategi:
--   1. Legg til `archived_at` / `archived_by` (idempotent IF NOT EXISTS).
--   2. LOCK + dedup som sikkerhetsnett for å unngå at en historisk duplikat
--      blokkerer opprettelse av den partielle indeksen.
--   3. Opprett partial unique index for aktive rader. Tabellen har historisk
--      ikke hatt UNIQUE-constraint, men koden har forutsatt at det ikke
--      finnes to aktive rader for samme (review_id, user_ident) — indeksen
--      gjør denne forutsetningen eksplisitt.
--
-- Idempotent via IF NOT EXISTS / IF EXISTS.

ALTER TABLE "routine_review_participants"
	ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "archived_by" text;
--> statement-breakpoint

LOCK TABLE "routine_review_participants" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint

WITH "duplicate_active_rows" AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "review_id", "user_ident"
			ORDER BY "id" ASC
		) AS "rn"
	FROM "routine_review_participants"
	WHERE "archived_at" IS NULL
)
UPDATE "routine_review_participants" AS "p"
SET "archived_at" = NOW(), "archived_by" = 'migration-0061-dedupe'
FROM "duplicate_active_rows" AS "d"
WHERE "p"."id" = "d"."id" AND "d"."rn" > 1;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "routine_review_participants_active_unique_idx"
	ON "routine_review_participants" ("review_id", "user_ident")
	WHERE "archived_at" IS NULL;
