import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { ROUTINE_FREQUENCIES } from "../../lib/routine-frequencies"
import {
	dataClassificationEnum,
	groupAccessClassificationEnum,
	groupCriticalityEnum,
	monitoredApplications,
	persistenceTypeEnum,
} from "./applications"
import { frameworkControls, technologyElements } from "./framework"
import { sections } from "./organization"
import { screeningQuestions } from "./screening"

// ─── Routines ────────────────────────────────────────────────────────────

export const ROUTINE_ACTIVITY_TYPES = ["entra_id_group_maintenance"] as const
export type RoutineActivityType = (typeof ROUTINE_ACTIVITY_TYPES)[number]

export const routineStatusEnum = ["draft", "active", "approved", "archived", "deleted"] as const
export type RoutineStatus = (typeof routineStatusEnum)[number]

export const routines = pgTable("routines", {
	id: uuid("id").primaryKey().defaultRandom(),
	sectionId: uuid("section_id")
		.notNull()
		.references(() => sections.id, { onDelete: "restrict" }),
	name: text("name").notNull(),
	description: text("description"),
	frequency: text("frequency", { enum: ROUTINE_FREQUENCIES }).notNull(),
	responsibleRole: text("responsible_role"),
	appliesToAllInSection: integer("applies_to_all_in_section").notNull().default(0),
	screeningQuestionId: uuid("screening_question_id").references(() => screeningQuestions.id, {
		onDelete: "set null",
	}),
	screeningChoiceValue: text("screening_choice_value"),
	activityType: text("activity_type", { enum: ROUTINE_ACTIVITY_TYPES }),
	status: text("status", { enum: routineStatusEnum }).notNull().default("active"),
	approvedBy: text("approved_by"),
	approvedAt: timestamp("approved_at", { withTimezone: true }),
	sourceRoutineId: uuid("source_routine_id"),
	replacedByRoutineId: uuid("replaced_by_routine_id"),
	replacedAt: timestamp("replaced_at", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	createdBy: text("created_by").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	updatedBy: text("updated_by").notNull(),
	archivedAt: timestamp("archived_at", { withTimezone: true }),
	archivedBy: text("archived_by"),
})

// ─── Routine ↔ Persistence linking ───────────────────────────────────────

export const routinePersistenceLinks = pgTable("routine_persistence_links", {
	id: uuid("id").primaryKey().defaultRandom(),
	routineId: uuid("routine_id")
		.notNull()
		.references(() => routines.id, { onDelete: "restrict" }),
	persistenceType: text("persistence_type", { enum: persistenceTypeEnum }),
	dataClassification: text("data_classification", { enum: dataClassificationEnum }),
})

// ─── Routine ↔ Group Access Classification linking ───────────────────────

export const routineGroupClassificationLinks = pgTable("routine_group_classification_links", {
	id: uuid("id").primaryKey().defaultRandom(),
	routineId: uuid("routine_id")
		.notNull()
		.references(() => routines.id, { onDelete: "restrict" }),
	classification: text("classification", { enum: groupAccessClassificationEnum }).notNull(),
})

// ─── Routine ↔ Oracle Role Criticality linking ───────────────────────────

export const routineOracleRoleCriticalityLinks = pgTable("routine_oracle_role_criticality_links", {
	id: uuid("id").primaryKey().defaultRandom(),
	routineId: uuid("routine_id")
		.notNull()
		.references(() => routines.id, { onDelete: "restrict" }),
	criticality: text("criticality", { enum: groupCriticalityEnum }).notNull(),
})

// ─── Routine ↔ Screening Question linking ────────────────────────────────

export const routineScreeningQuestions = pgTable("routine_screening_questions", {
	id: uuid("id").primaryKey().defaultRandom(),
	routineId: uuid("routine_id")
		.notNull()
		.references(() => routines.id, { onDelete: "restrict" }),
	questionId: uuid("question_id")
		.notNull()
		.references(() => screeningQuestions.id, { onDelete: "restrict" }),
	choiceValue: text("choice_value"),
})

// ─── Routine ↔ Framework Control linking ─────────────────────────────────

export const routineControls = pgTable("routine_controls", {
	id: uuid("id").primaryKey().defaultRandom(),
	routineId: uuid("routine_id")
		.notNull()
		.references(() => routines.id, { onDelete: "restrict" }),
	controlId: uuid("control_id")
		.notNull()
		.references(() => frameworkControls.id, { onDelete: "cascade" }),
})

// ─── Routine ↔ Technology Element linking ────────────────────────────────

export const routineTechnologyElements = pgTable("routine_technology_elements", {
	id: uuid("id").primaryKey().defaultRandom(),
	routineId: uuid("routine_id")
		.notNull()
		.references(() => routines.id, { onDelete: "restrict" }),
	elementId: uuid("element_id")
		.notNull()
		.references(() => technologyElements.id, { onDelete: "cascade" }),
})

// ─── Routine Reviews ─────────────────────────────────────────────────────

export const routineReviews = pgTable("routine_reviews", {
	id: uuid("id").primaryKey().defaultRandom(),
	routineId: uuid("routine_id")
		.notNull()
		.references(() => routines.id, { onDelete: "restrict" }),
	applicationId: uuid("application_id").references(() => monitoredApplications.id, {
		onDelete: "restrict",
	}),
	title: text("title").notNull(),
	summary: text("summary"),
	routineSnapshotPath: text("routine_snapshot_path"),
	status: text("status", { enum: ["draft", "completed", "discarded"] })
		.notNull()
		.default("draft"),
	reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull(),
	createdBy: text("created_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

// ─── Review Participants ─────────────────────────────────────────────────

export const routineReviewParticipants = pgTable("routine_review_participants", {
	id: uuid("id").primaryKey().defaultRandom(),
	reviewId: uuid("review_id")
		.notNull()
		.references(() => routineReviews.id, { onDelete: "cascade" }),
	userIdent: text("user_ident").notNull(),
	userName: text("user_name"),
	confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
})

// ─── Review Attachments ──────────────────────────────────────────────────

export const routineReviewAttachments = pgTable("routine_review_attachments", {
	id: uuid("id").primaryKey().defaultRandom(),
	reviewId: uuid("review_id")
		.notNull()
		.references(() => routineReviews.id, { onDelete: "cascade" }),
	fileName: text("file_name").notNull(),
	bucketPath: text("bucket_path").notNull(),
	contentType: text("content_type").notNull(),
	sizeBytes: integer("size_bytes"),
	uploadedBy: text("uploaded_by").notNull(),
	uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
})

// ─── Review Links ────────────────────────────────────────────────────────

export const routineReviewLinks = pgTable("routine_review_links", {
	id: uuid("id").primaryKey().defaultRandom(),
	reviewId: uuid("review_id")
		.notNull()
		.references(() => routineReviews.id, { onDelete: "cascade" }),
	url: text("url").notNull(),
	title: text("title"),
	addedBy: text("added_by").notNull(),
	addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
})

// ─── Review Activities ───────────────────────────────────────────────────

export const REVIEW_ACTIVITY_STATUSES = ["pending", "completed"] as const
export const ENTRA_CHANGE_TYPES = ["added", "removed", "criticality_changed"] as const
export type EntraChangeType = (typeof ENTRA_CHANGE_TYPES)[number]

export const routineReviewActivities = pgTable("routine_review_activities", {
	id: uuid("id").primaryKey().defaultRandom(),
	reviewId: uuid("review_id")
		.notNull()
		.references(() => routineReviews.id, { onDelete: "cascade" }),
	type: text("type", { enum: ROUTINE_ACTIVITY_TYPES }).notNull(),
	status: text("status", { enum: REVIEW_ACTIVITY_STATUSES }).notNull().default("pending"),
	snapshotBefore: jsonb("snapshot_before"),
	snapshotAfter: jsonb("snapshot_after"),
	completedAt: timestamp("completed_at", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const routineReviewActivityEntraChanges = pgTable("routine_review_activity_entra_changes", {
	id: uuid("id").primaryKey().defaultRandom(),
	activityId: uuid("activity_id")
		.notNull()
		.references(() => routineReviewActivities.id, { onDelete: "cascade" }),
	changeType: text("change_type", { enum: ENTRA_CHANGE_TYPES }).notNull(),
	groupId: text("group_id").notNull(),
	groupName: text("group_name"),
	previousValue: text("previous_value"),
	newValue: text("new_value"),
	performedBy: text("performed_by").notNull(),
	performedAt: timestamp("performed_at", { withTimezone: true }).notNull().defaultNow(),
})
