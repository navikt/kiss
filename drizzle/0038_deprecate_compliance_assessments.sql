-- Mark legacy compliance_assessments tables as deprecated. The tables are kept
-- for historical audit-trail, but no production code writes new rows to them.
-- Compliance status is now derived from screening, rulesets, routines and the
-- materialized application_controls table.

COMMENT ON TABLE "compliance_assessments" IS 'DEPRECATED: kept for historical audit-trail only. Compliance is derived from application_controls. Do not insert/update.';
COMMENT ON TABLE "compliance_assessment_history" IS 'DEPRECATED: kept for historical audit-trail only. Compliance is derived from application_controls. Do not insert/update.';
