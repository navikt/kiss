-- Soft-delete-konsolidering for rulesets. Tabellen hadde allerede
-- `archived_at` og `archiveRuleset()`-funksjon, men manglet:
--   * `archived_by`-kolonne (hvem arkiverte)
--   * audit-skriving (`ruleset_archived` / `ruleset_unarchived`)
--   * idempotent atomisk guarded UPDATE i transaksjon
--   * `unarchiveRuleset()`-funksjon
--
-- Denne migrasjonen legger kun til `archived_by`. FK-er fra rulesets til
-- andre tabeller er allerede `RESTRICT` (sectionId via 0040, routineId via
-- 0042); innkommende FK-er er `CASCADE` (ruleset_approvals/_controls/
-- _routines/_attachments) — uendret, da rulesets aldri slettes hardt.
--
-- Samme generelle mønster som migrasjonene 0040–0046. Idempotens er
-- sikret via IF NOT EXISTS.

ALTER TABLE "rulesets" ADD COLUMN IF NOT EXISTS "archived_by" text;
