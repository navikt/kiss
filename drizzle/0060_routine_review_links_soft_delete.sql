-- Soft-delete (logisk arkivering) for `routine_review_links`.
--
-- Tidligere ble lenker hard-slettet via `deleteReviewLink()`, slik at vi
-- mistet sporbarhet på hvilke lenker en gjennomgang har inneholdt — inkludert
-- hvem som la dem til/fjernet dem og når. Dette er compliance-relevant
-- historikk (revisjonsbevis), så raden må bevares ved «sletting».
--
-- Strategi:
--   1. Legg til `archived_at` / `archived_by` (idempotent IF NOT EXISTS).
--   2. Tabellen har ingen unik constraint, så ingen dedup eller partiell
--      indeks er nødvendig.
--   3. Konverter FK til `routine_reviews` fra ON DELETE CASCADE til
--      ON DELETE RESTRICT. CASCADE bryter med soft-delete-kontrakten:
--      en hard-DELETE på review-raden ville cascade og slette alle links —
--      inkludert arkiverte rader som er compliance-historikk.
--
-- Idempotent via IF NOT EXISTS / DROP CONSTRAINT IF EXISTS.

ALTER TABLE "routine_review_links"
	ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "archived_by" text;
--> statement-breakpoint

ALTER TABLE "routine_review_links"
	DROP CONSTRAINT IF EXISTS "routine_review_links_review_id_fkey";
--> statement-breakpoint
ALTER TABLE "routine_review_links"
	DROP CONSTRAINT IF EXISTS "routine_review_links_review_id_routine_reviews_id_fk";
--> statement-breakpoint
ALTER TABLE "routine_review_links"
	ADD CONSTRAINT "routine_review_links_review_id_routine_reviews_id_fk"
	FOREIGN KEY ("review_id") REFERENCES "routine_reviews"("id")
	ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "routine_review_links"
	VALIDATE CONSTRAINT "routine_review_links_review_id_routine_reviews_id_fk";
--> statement-breakpoint
