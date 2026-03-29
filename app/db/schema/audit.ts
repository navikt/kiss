import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

export const auditLogActionEnum = [
	"framework_imported",
	"framework_activated",
	"framework_archived",
	"risk_short_title_updated",
	"control_short_title_updated",
] as const

export type AuditLogAction = (typeof auditLogActionEnum)[number]

export const auditLog = pgTable("audit_log", {
	id: uuid("id").primaryKey().defaultRandom(),
	action: text("action", { enum: auditLogActionEnum }).notNull(),
	entityType: text("entity_type").notNull(),
	entityId: text("entity_id").notNull(),
	previousValue: text("previous_value"),
	newValue: text("new_value"),
	metadata: text("metadata"),
	performedBy: text("performed_by").notNull(),
	performedAt: timestamp("performed_at", { withTimezone: true }).notNull().defaultNow(),
})
