-- Soft-delete (logisk arkivering) for `control_predefined_answers`.
--
-- Tidligere ble forhåndsdefinerte svar hard-slettet via `deletePredefinedAnswer()`,
-- slik at vi mistet sporbarhet på hvilke svar en kontroll har vært konfigurert
-- med — inkludert hvem som la dem til/fjernet dem og når. Dette er compliance-
-- relevante data (kontrollens svaralternativer påvirker screening og rapporter),
-- så historikken må bevares.
--
-- Strategi:
--   1. Legg til `archived_at` / `archived_by` (idempotent IF NOT EXISTS).
--
-- Tabellen har ingen UNIQUE-constraint som må konverteres til partiell indeks,
-- så vi nøyer oss med å legge til de to kolonnene. Idempotent via IF NOT EXISTS.

ALTER TABLE "control_predefined_answers"
	ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "archived_by" text;
