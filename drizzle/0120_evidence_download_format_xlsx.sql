-- NDA sin deployments-bevisleverandør bruker formatstrengen 'xlsx' (ikke 'excel'),
-- men constrainten tillot kun 'excel'/'pdf' fra Oracle-leverandøren. Utvider til å
-- tillate begge slik at "Registrer XLSX som bevis" ikke feiler med check_violation.
ALTER TABLE "routine_review_evidence_downloads" DROP CONSTRAINT IF EXISTS "evidence_download_format_check";
ALTER TABLE "routine_review_evidence_downloads" ADD CONSTRAINT "evidence_download_format_check"
	CHECK ("format" IN ('excel', 'pdf', 'xlsx'));
