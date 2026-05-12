import { sql } from "drizzle-orm"
import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { ROUTINE_ACTIVITY_TYPES } from "../../lib/activity-types"
import { EVIDENCE_PROVIDER_TYPES } from "../../lib/evidence-providers/types"
import { ROUTINE_FREQUENCIES } from "../../lib/routine-frequencies"
import {
	dataClassificationEnum,
	groupAccessClassificationEnum,
	groupCriticalityEnum,
	monitoredApplications,
	persistenceTypeEnum,
} from "./applications"
import { bucketObjects } from "./buckets"
import { frameworkControls, technologyElements } from "./framework"
import { sections } from "./organization"
import { screeningQuestions } from "./screening"

export type {
	DeploymentEvidenceActivityType,
	OracleEvidenceActivityType,
	RoutineActivityType,
} from "../../lib/activity-types"
// Re-export activity type definitions from the DB-free module
export {
	ACTIVITY_TYPE_GROUPS,
	activityTypeLabels,
	DEPLOYMENT_EVIDENCE_ACTIVITY_TYPES,
	deploymentEvidenceTypesForActivity,
	getEvidenceTypesForActivity,
	getProviderTypeForActivity,
	isDeploymentEvidenceActivityType,
	isOracleEvidenceActivityType,
	ORACLE_EVIDENCE_ACTIVITY_TYPES,
	oracleEvidenceTypesForActivity,
	ROUTINE_ACTIVITY_TYPES,
} from "../../lib/activity-types"

// ─── Routines ────────────────────────────────────────────────────────────

export const routineStatusEnum = ["draft", "ready", "approved", "archived", "deleted"] as const
export type RoutineStatus = (typeof routineStatusEnum)[number]

export const routines = pgTable("routines", {
	id: uuid("id").primaryKey().defaultRandom(),
	sectionId: uuid("section_id")
		.notNull()
		.references(() => sections.id, { onDelete: "restrict" }),
	name: text("name").notNull(),
	description: text("description"),
	frequency: text("frequency", { enum: ROUTINE_FREQUENCIES }),
	eventFrequency: text("event_frequency"),
	responsibleRole: text("responsible_role"),
	appliesToAllInSection: integer("applies_to_all_in_section").notNull().default(0),
	isSectionRoutine: integer("is_section_routine").notNull().default(0),
	sectionRoutineOwnerRole: text("section_routine_owner_role"),
	screeningQuestionId: uuid("screening_question_id").references(() => screeningQuestions.id, {
		onDelete: "set null",
	}),
	screeningChoiceValue: text("screening_choice_value"),
	activityType: text("activity_type", { enum: ROUTINE_ACTIVITY_TYPES }),
	status: text("status", { enum: routineStatusEnum }).notNull().default("draft"),
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
	archivedAt: timestamp("archived_at", { withTimezone: true }),
	archivedBy: text("archived_by"),
})

// ─── Routine ↔ Group Access Classification linking ───────────────────────

export const routineGroupClassificationLinks = pgTable("routine_group_classification_links", {
	id: uuid("id").primaryKey().defaultRandom(),
	routineId: uuid("routine_id")
		.notNull()
		.references(() => routines.id, { onDelete: "restrict" }),
	classification: text("classification", { enum: groupAccessClassificationEnum }).notNull(),
	archivedAt: timestamp("archived_at", { withTimezone: true }),
	archivedBy: text("archived_by"),
})

// ─── Routine ↔ Oracle Role Criticality linking ───────────────────────────

export const routineOracleRoleCriticalityLinks = pgTable("routine_oracle_role_criticality_links", {
	id: uuid("id").primaryKey().defaultRandom(),
	routineId: uuid("routine_id")
		.notNull()
		.references(() => routines.id, { onDelete: "restrict" }),
	criticality: text("criticality", { enum: groupCriticalityEnum }).notNull(),
	archivedAt: timestamp("archived_at", { withTimezone: true }),
	archivedBy: text("archived_by"),
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
	archivedAt: timestamp("archived_at", { withTimezone: true }),
	archivedBy: text("archived_by"),
})

// ─── Routine ↔ Framework Control linking ─────────────────────────────────

export const routineControls = pgTable("routine_controls", {
	id: uuid("id").primaryKey().defaultRandom(),
	routineId: uuid("routine_id")
		.notNull()
		.references(() => routines.id, { onDelete: "restrict" }),
	controlId: uuid("control_id")
		.notNull()
		.references(() => frameworkControls.id, { onDelete: "restrict" }),
	archivedAt: timestamp("archived_at", { withTimezone: true }),
	archivedBy: text("archived_by"),
})

// ─── Routine ↔ Technology Element linking ────────────────────────────────

export const routineTechnologyElements = pgTable("routine_technology_elements", {
	id: uuid("id").primaryKey().defaultRandom(),
	routineId: uuid("routine_id")
		.notNull()
		.references(() => routines.id, { onDelete: "restrict" }),
	elementId: uuid("element_id")
		.notNull()
		.references(() => technologyElements.id, { onDelete: "restrict" }),
	archivedAt: timestamp("archived_at", { withTimezone: true }),
	archivedBy: text("archived_by"),
})

// ─── Routine Reviews ─────────────────────────────────────────────────────

export const reviewStatusEnum = ["draft", "needs_follow_up", "completed", "discarded"] as const
export type ReviewStatus = (typeof reviewStatusEnum)[number]

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
	status: text("status", { enum: reviewStatusEnum }).notNull().default("draft"),
	reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull(),
	createdBy: text("created_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

// ─── Review Participants ─────────────────────────────────────────────────

export const routineReviewParticipants = pgTable(
	"routine_review_participants",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		reviewId: uuid("review_id")
			.notNull()
			.references(() => routineReviews.id, { onDelete: "cascade" }),
		userIdent: text("user_ident").notNull(),
		userName: text("user_name"),
		confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		archivedBy: text("archived_by"),
	},
	(table) => [
		uniqueIndex("routine_review_participants_active_unique_idx")
			.on(table.reviewId, table.userIdent)
			.where(sql`${table.archivedAt} IS NULL`),
	],
)

// ─── Review Attachments ──────────────────────────────────────────────────

export const ATTACHMENT_SOURCE_TYPES = ["manual", "automated"] as const
export type AttachmentSourceType = (typeof ATTACHMENT_SOURCE_TYPES)[number]

export const routineReviewAttachments = pgTable("routine_review_attachments", {
	id: uuid("id").primaryKey().defaultRandom(),
	reviewId: uuid("review_id")
		.notNull()
		.references(() => routineReviews.id, { onDelete: "cascade" }),
	fileName: text("file_name").notNull(),
	bucketPath: text("bucket_path").notNull(),
	contentType: text("content_type").notNull(),
	sizeBytes: integer("size_bytes"),
	sourceType: text("source_type", { enum: ATTACHMENT_SOURCE_TYPES }).notNull().default("manual"),
	uploadedBy: text("uploaded_by").notNull(),
	uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
})

// ─── Review Links ────────────────────────────────────────────────────────

export const routineReviewLinks = pgTable("routine_review_links", {
	id: uuid("id").primaryKey().defaultRandom(),
	reviewId: uuid("review_id")
		.notNull()
		.references(() => routineReviews.id, { onDelete: "restrict" }),
	url: text("url").notNull(),
	title: text("title"),
	addedBy: text("added_by").notNull(),
	addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
	archivedAt: timestamp("archived_at", { withTimezone: true }),
	archivedBy: text("archived_by"),
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

// ─── Evidence Downloads ──────────────────────────────────────────────────

export const EVIDENCE_DOWNLOAD_SOURCES = ["m2m_api", "manual_upload"] as const
export type EvidenceDownloadSource = (typeof EVIDENCE_DOWNLOAD_SOURCES)[number]

export { EVIDENCE_PROVIDER_TYPES, type EvidenceProviderType } from "../../lib/evidence-providers/types"

export const routineReviewEvidenceDownloads = pgTable("routine_review_evidence_downloads", {
	id: uuid("id").primaryKey().defaultRandom(),
	activityId: uuid("activity_id")
		.notNull()
		.references(() => routineReviewActivities.id, { onDelete: "restrict" }),
	bucketObjectId: uuid("bucket_object_id")
		.notNull()
		.references(() => bucketObjects.id, { onDelete: "restrict" }),
	providerType: text("provider_type", { enum: EVIDENCE_PROVIDER_TYPES }).notNull(),
	providerMetadata: jsonb("provider_metadata").notNull(),
	format: text("format").notNull(),
	fileName: text("file_name").notNull(),
	source: text("source", { enum: EVIDENCE_DOWNLOAD_SOURCES }).notNull().default("m2m_api"),
	collectedAt: timestamp("collected_at", { withTimezone: true }),
	forceFetchJustification: text("force_fetch_justification"),
	performedBy: text("performed_by").notNull(),
	performedAt: timestamp("performed_at", { withTimezone: true }).notNull().defaultNow(),
})

// ─── Review Follow-up Points ─────────────────────────────────────────────

export const FOLLOW_UP_POINT_STATUSES = ["needs_follow_up", "completed", "not_relevant"] as const
export type FollowUpPointStatus = (typeof FOLLOW_UP_POINT_STATUSES)[number]

export const routineReviewFollowUpPoints = pgTable("routine_review_follow_up_points", {
	id: uuid("id").primaryKey().defaultRandom(),
	reviewId: uuid("review_id")
		.notNull()
		.references(() => routineReviews.id, { onDelete: "cascade" }),
	text: text("text").notNull(),
	description: text("description"),
	resolution: text("resolution"),
	status: text("status", { enum: FOLLOW_UP_POINT_STATUSES }).notNull().default("needs_follow_up"),
	createdBy: text("created_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedBy: text("updated_by").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	resolvedAt: timestamp("resolved_at", { withTimezone: true }),
	resolvedBy: text("resolved_by"),
})

// ─── Review Follow-up Point Attachments ──────────────────────────────────

export const followUpPointAttachmentKindEnum = ["description", "resolution"] as const
export type FollowUpPointAttachmentKind = (typeof followUpPointAttachmentKindEnum)[number]

export const routineReviewFollowUpPointAttachments = pgTable("routine_review_follow_up_point_attachments", {
	id: uuid("id").primaryKey().defaultRandom(),
	pointId: uuid("point_id")
		.notNull()
		.references(() => routineReviewFollowUpPoints.id, { onDelete: "cascade" }),
	kind: text("kind").notNull().default("resolution").$type<FollowUpPointAttachmentKind>(),
	fileName: text("file_name").notNull(),
	bucketPath: text("bucket_path").notNull(),
	contentType: text("content_type").notNull(),
	sizeBytes: integer("size_bytes"),
	uploadedBy: text("uploaded_by").notNull(),
	uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
})
