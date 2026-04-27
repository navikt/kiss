-- Soft-delete (logisk arkivering) for `user_roles`.
--
-- Tidligere ble rolletildelinger hard-slettet via `removeRole()`, slik at vi
-- mistet sporbarhet på hvilke roller en bruker har hatt — inkludert hvem som
-- tildelte/revoka dem og når. Dette er compliance-relevante data, så
-- historikken må bevares.
--
-- Strategi:
--   1. Legg til `archived_at` / `archived_by` (idempotent IF NOT EXISTS).
--
-- Det finnes ingen UNIQUE-constraint på `user_roles` (en bruker kan i prinsippet
-- ha flere identiske rolletildelinger), så vi trenger ikke en partiell unik
-- indeks her — i motsetning til tidligere SD-migrasjoner.
--
-- Idempotent via IF NOT EXISTS.

ALTER TABLE "user_roles"
	ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "archived_by" text;
