import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

export const auditLogActionEnum = [
	"framework_imported",
	"framework_activated",
	"framework_archived",
	"risk_short_title_updated",
	"control_short_title_updated",
	"section_created",
	"section_updated",
	"section_deleted",
	"team_created",
	"team_updated",
	"team_deleted",
	"nais_team_status_updated",
	"nais_team_section_linked",
	"nais_team_section_unlinked",
	"nais_sync_completed",
	"app_team_linked",
	"app_team_unlinked",
	"control_field_updated",
	"report_generated",
	"section_app_ignored",
	"section_app_unignored",
	"nais_persistence_synced",
	"application_linked",
	"application_unlinked",
	"predefined_answer_created",
	"predefined_answer_updated",
	"predefined_answer_deleted",
	"screening_question_created",
	"screening_question_updated",
	"screening_question_deleted",
	"screening_answer_saved",
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
