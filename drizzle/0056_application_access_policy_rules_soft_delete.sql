-- Soft-delete (logisk arkivering) for `application_access_policy_rules`.
--
-- Tidligere ble access policy-regler hard-slettet ved hver Nais-sync (delete-
-- alle + reinsert per direction). Det betydde at vi mistet sporbarhet på
-- hvilke inbound/outbound-regler en applikasjon har vært konfigurert med
-- — inkludert når de dukket opp og forsvant. Dette er compliance-relevante
-- data (revisjonsbevis), så historikken må bevares.
--
-- Strategi:
--   1. Legg til `archived_at` / `archived_by` (idempotent IF NOT EXISTS).
--   2. Erstatt eksisterende `access_policy_unique_rule` med en partial
--      UNIQUE-index som kun gjelder aktive rader (`archived_at IS NULL`),
--      slik at en tidligere arkivert regel kan legges til på nytt.
--
-- Idempotent via IF NOT EXISTS og defensiv sjekk av eksisterende index.

ALTER TABLE "application_access_policy_rules"
	ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "archived_by" text;

-- Gjør den eksisterende UNIQUE-indeksen partial. Hopp over hvis den allerede
-- har WHERE-klausul (re-run-safe).
DO $$
BEGIN
	-- Sjekk om indeksen allerede er partial (uavhengig av om PG wrapper WHERE
	-- i parens eller ikke).
	IF EXISTS (
		SELECT 1 FROM pg_indexes
		WHERE indexname = 'access_policy_unique_rule'
		  AND tablename = 'application_access_policy_rules'
		  AND indexdef ILIKE '%WHERE%archived_at IS NULL%'
	) THEN
		RETURN;
	END IF;

	-- Drop den ikke-partielle indeksen hvis den finnes.
	DROP INDEX IF EXISTS "access_policy_unique_rule";

	-- Gjenskape med partial filter. Samme COALESCE-uttrykk som 0002.
	CREATE UNIQUE INDEX "access_policy_unique_rule"
		ON "application_access_policy_rules" (
			"application_id", "direction", "rule_application",
			COALESCE("rule_namespace", ''), COALESCE("rule_cluster", '')
		)
		WHERE archived_at IS NULL;
END $$;
