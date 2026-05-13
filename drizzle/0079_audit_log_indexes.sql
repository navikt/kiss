-- Add indexes on audit_log for common query patterns
CREATE INDEX IF NOT EXISTS "idx_audit_log_action_performed_at" ON "audit_log" ("action", "performed_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_audit_log_entity_performed_at" ON "audit_log" ("entity_type", "entity_id", "performed_at" DESC);
