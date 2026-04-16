import { boolean, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"
import { COMPLIANCE_STATUSES } from "~/lib/compliance-status"
import { monitoredApplications } from "./applications"
import { frameworkControls, technologyElements } from "./framework"

// ─── Application Controls (materialized compliance cache) ────────────────

export const APPLICATION_CONTROL_HISTORY_ACTIONS = [
	"activated",
	"deactivated",
	"status_changed",
	"comment_changed",
] as const
export type ApplicationControlHistoryAction = (typeof APPLICATION_CONTROL_HISTORY_ACTIONS)[number]

export const ROUTINE_ESTABLISHMENT_VALUES = ["established", "not_established", "not_relevant"] as const
export const ROUTINE_COMPLIANCE_VALUES = ["completed", "overdue", "never_reviewed", "not_applicable"] as const

export const applicationControls = pgTable(
	"application_controls",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		applicationId: uuid("application_id")
			.notNull()
			.references(() => monitoredApplications.id, { onDelete: "cascade" }),
		controlId: uuid("control_id")
			.notNull()
			.references(() => frameworkControls.id, { onDelete: "cascade" }),
		technologyElementId: uuid("technology_element_id").references(() => technologyElements.id, {
			onDelete: "cascade",
		}),

		// Auto-computed compliance status
		status: text("status", { enum: COMPLIANCE_STATUSES }),
		autoReason: text("auto_reason"),

		// Two-dimensional model
		establishment: text("establishment", { enum: ROUTINE_ESTABLISHMENT_VALUES }).notNull().default("not_established"),
		routineCompliance: text("routine_compliance", { enum: ROUTINE_COMPLIANCE_VALUES })
			.notNull()
			.default("not_applicable"),
		routinesEstablished: integer("routines_established").notNull().default(0),
		routinesCompleted: integer("routines_completed").notNull().default(0),
		routinesOverdue: integer("routines_overdue").notNull().default(0),

		// Match metadata
		matchSources: text("match_sources").array(),
		matchingRoutineIds: uuid("matching_routine_ids").array(),
		isScreeningDerived: boolean("is_screening_derived").notNull().default(true),

		// User comment (preserved across deactivation/reactivation)
		comment: text("comment"),
		commentUpdatedAt: timestamp("comment_updated_at", { withTimezone: true }),
		commentUpdatedBy: text("comment_updated_by"),

		// Soft delete
		isActive: boolean("is_active").notNull().default(true),
		deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
		deactivatedReason: text("deactivated_reason"),
		activatedAt: timestamp("activated_at", { withTimezone: true }).defaultNow(),

		// Audit
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		createdBy: text("created_by").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
		updatedBy: text("updated_by").notNull(),
	},
	(t) => [unique("uq_app_control").on(t.applicationId, t.controlId, t.technologyElementId)],
)

export const applicationControlHistory = pgTable("application_control_history", {
	id: uuid("id").primaryKey().defaultRandom(),
	applicationControlId: uuid("application_control_id")
		.notNull()
		.references(() => applicationControls.id, { onDelete: "cascade" }),
	action: text("action", { enum: APPLICATION_CONTROL_HISTORY_ACTIONS }).notNull(),
	previousStatus: text("previous_status", { enum: COMPLIANCE_STATUSES }),
	newStatus: text("new_status", { enum: COMPLIANCE_STATUSES }),
	previousComment: text("previous_comment"),
	newComment: text("new_comment"),
	reason: text("reason"),
	performedBy: text("performed_by").notNull(),
	performedAt: timestamp("performed_at", { withTimezone: true }).notNull().defaultNow(),
})
