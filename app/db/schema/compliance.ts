import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { monitoredApplications } from "./applications"
import { frameworkControls, frameworkVersions } from "./framework"

export const complianceStatusEnum = ["not_relevant", "not_implemented", "partially_implemented", "implemented"] as const
export type ComplianceStatus = (typeof complianceStatusEnum)[number]

export const complianceAssessments = pgTable("compliance_assessments", {
	id: uuid("id").primaryKey().defaultRandom(),
	applicationId: uuid("application_id")
		.notNull()
		.references(() => monitoredApplications.id),
	controlId: uuid("control_id")
		.notNull()
		.references(() => frameworkControls.id),
	frameworkVersionId: uuid("framework_version_id")
		.notNull()
		.references(() => frameworkVersions.id),
	status: text("status", { enum: complianceStatusEnum }).notNull(),
	comment: text("comment"),
	assessedBy: text("assessed_by").notNull(),
	assessedAt: timestamp("assessed_at", { withTimezone: true }).notNull().defaultNow(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	createdBy: text("created_by").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	updatedBy: text("updated_by").notNull(),
})

export const complianceAssessmentHistory = pgTable("compliance_assessment_history", {
	id: uuid("id").primaryKey().defaultRandom(),
	assessmentId: uuid("assessment_id")
		.notNull()
		.references(() => complianceAssessments.id),
	previousStatus: text("previous_status", { enum: complianceStatusEnum }),
	newStatus: text("new_status", { enum: complianceStatusEnum }).notNull(),
	previousComment: text("previous_comment"),
	newComment: text("new_comment"),
	changedBy: text("changed_by").notNull(),
	changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
})
