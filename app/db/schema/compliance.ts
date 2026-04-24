import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { COMPLIANCE_STATUSES, type ComplianceStatus } from "~/lib/compliance-status"
import { monitoredApplications } from "./applications"
import { frameworkControls, technologyElements } from "./framework"

export { COMPLIANCE_STATUSES as complianceStatusEnum, type ComplianceStatus }

/**
 * @deprecated Legacy tabell. Compliance-status skal nå utledes fra screening-spørsmål,
 * regelsett og rutiner — ikke direkte vurderinger per kontroll.
 * Ikke bruk denne tabellen i nye funksjoner.
 */
export const complianceAssessments = pgTable("compliance_assessments", {
	id: uuid("id").primaryKey().defaultRandom(),
	applicationId: uuid("application_id")
		.notNull()
		.references(() => monitoredApplications.id, { onDelete: "restrict" }),
	controlId: uuid("control_id")
		.notNull()
		.references(() => frameworkControls.id),
	technologyElementId: uuid("technology_element_id").references(() => technologyElements.id, {
		onDelete: "restrict",
	}),
	status: text("status", { enum: COMPLIANCE_STATUSES }).notNull(),
	comment: text("comment"),
	assessedBy: text("assessed_by").notNull(),
	assessedAt: timestamp("assessed_at", { withTimezone: true }).notNull().defaultNow(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	createdBy: text("created_by").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	updatedBy: text("updated_by").notNull(),
})

/**
 * @deprecated Legacy tabell. Historikk for complianceAssessments.
 * Ikke bruk i nye funksjoner.
 */
export const complianceAssessmentHistory = pgTable("compliance_assessment_history", {
	id: uuid("id").primaryKey().defaultRandom(),
	assessmentId: uuid("assessment_id")
		.notNull()
		.references(() => complianceAssessments.id),
	previousStatus: text("previous_status", { enum: COMPLIANCE_STATUSES }),
	newStatus: text("new_status", { enum: COMPLIANCE_STATUSES }).notNull(),
	previousComment: text("previous_comment"),
	newComment: text("new_comment"),
	changedBy: text("changed_by").notNull(),
	changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
})
