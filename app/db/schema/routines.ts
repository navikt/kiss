import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { ROUTINE_FREQUENCIES } from "../../lib/routine-frequencies"
import { dataClassificationEnum, monitoredApplications, persistenceTypeEnum } from "./applications"
import { frameworkControls, technologyElements } from "./framework"
import { sections } from "./organization"
import { screeningQuestions } from "./screening"

// ─── Routines ────────────────────────────────────────────────────────────

export const routines = pgTable("routines", {
	id: uuid("id").primaryKey().defaultRandom(),
	sectionId: uuid("section_id")
		.notNull()
		.references(() => sections.id, { onDelete: "cascade" }),
	name: text("name").notNull(),
	description: text("description"),
	frequency: text("frequency", { enum: ROUTINE_FREQUENCIES }).notNull(),
	responsibleRole: text("responsible_role"),
	appliesToAllInSection: integer("applies_to_all_in_section").notNull().default(0),
	screeningQuestionId: uuid("screening_question_id").references(() => screeningQuestions.id, {
		onDelete: "set null",
	}),
	screeningChoiceValue: text("screening_choice_value"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	createdBy: text("created_by").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	updatedBy: text("updated_by").notNull(),
})

// ─── Routine ↔ Persistence linking ───────────────────────────────────────

export const routinePersistenceLinks = pgTable("routine_persistence_links", {
	id: uuid("id").primaryKey().defaultRandom(),
	routineId: uuid("routine_id")
		.notNull()
		.references(() => routines.id, { onDelete: "cascade" }),
	persistenceType: text("persistence_type", { enum: persistenceTypeEnum }),
	dataClassification: text("data_classification", { enum: dataClassificationEnum }),
})

// ─── Routine ↔ Screening Question linking ────────────────────────────────

export const routineScreeningQuestions = pgTable("routine_screening_questions", {
	id: uuid("id").primaryKey().defaultRandom(),
	routineId: uuid("routine_id")
		.notNull()
		.references(() => routines.id, { onDelete: "cascade" }),
	questionId: uuid("question_id")
		.notNull()
		.references(() => screeningQuestions.id, { onDelete: "cascade" }),
	choiceValue: text("choice_value"),
})

// ─── Routine ↔ Framework Control linking ─────────────────────────────────

export const routineControls = pgTable("routine_controls", {
	id: uuid("id").primaryKey().defaultRandom(),
	routineId: uuid("routine_id")
		.notNull()
		.references(() => routines.id, { onDelete: "cascade" }),
	controlId: uuid("control_id")
		.notNull()
		.references(() => frameworkControls.id, { onDelete: "cascade" }),
})

// ─── Routine ↔ Technology Element linking ────────────────────────────────

export const routineTechnologyElements = pgTable("routine_technology_elements", {
	id: uuid("id").primaryKey().defaultRandom(),
	routineId: uuid("routine_id")
		.notNull()
		.references(() => routines.id, { onDelete: "cascade" }),
	elementId: uuid("element_id")
		.notNull()
		.references(() => technologyElements.id, { onDelete: "cascade" }),
})

// ─── Routine Reviews ─────────────────────────────────────────────────────

export const routineReviews = pgTable("routine_reviews", {
	id: uuid("id").primaryKey().defaultRandom(),
	routineId: uuid("routine_id")
		.notNull()
		.references(() => routines.id, { onDelete: "cascade" }),
	applicationId: uuid("application_id").references(() => monitoredApplications.id, {
		onDelete: "set null",
	}),
	title: text("title").notNull(),
	summary: text("summary"),
	routineSnapshotPath: text("routine_snapshot_path"),
	status: text("status", { enum: ["draft", "completed"] })
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
