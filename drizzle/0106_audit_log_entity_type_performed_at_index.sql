CREATE INDEX IF NOT EXISTS "idx_audit_log_entity_type_performed_at" ON "audit_log" ("entity_type", "performed_at" DESC);
