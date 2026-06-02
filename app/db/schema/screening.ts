import { sql } from "drizzle-orm"
import { boolean, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { monitoredApplications } from "./applications"
import { complianceStatusEnum } from "./compliance"
import { frameworkControls, technologyElements } from "./framework"
import { sections } from "./organization"
import { rulesets } from "./rulesets"

/** Extended effect enum that includes screening-specific effects beyond compliance statuses. */
export const screeningEffectEnum = [...complianceStatusEnum, "select_routine", "preset_routine"] as const
export type ScreeningEffect = (typeof screeningEffectEnum)[number]

export const screeningEffectLabels: Record<string, string> = {
	not_relevant: "Ikke relevant",
	select_routine: "Velg rutine",
	preset_routine: "Valgt rutine",
}

export const screeningQuestionStatusEnum = ["draft", "ready", "approved", "archived"] as const
export type ScreeningQuestionStatus = (typeof screeningQuestionStatusEnum)[number]

/** Statuses that can be set via changeStatus action (excludes 'archived' which uses archive flow). */
export const validScreeningQuestionStatuses = ["draft", "ready", "approved"] as const
export type ValidScreeningQuestionStatus = (typeof validScreeningQuestionStatuses)[number]

export const screeningQuestionStatusConfig: Record<
	ScreeningQuestionStatus,
	{ label: string; variant: "neutral" | "info" | "success" | "warning" }
> = {
	draft: { label: "Kladd", variant: "neutral" },
	ready: { label: "Ferdig", variant: "info" },
	approved: { label: "Godkjent", variant: "success" },
	archived: { label: "Arkivert", variant: "warning" },
}

/** Screening questions shown before detailed compliance assessment. */
export const screeningQuestions = pgTable("screening_questions", {
	id: uuid("id").primaryKey().defaultRandom(),
	sectionId: uuid("section_id").references(() => sections.id, { onDelete: "restrict" }),
	rulesetId: uuid("ruleset_id").references(() => rulesets.id, { onDelete: "set null" }),
	rulesetCategoryFilter: text("ruleset_category_filter"),
	questionText: text("question_text").notNull(),
	description: text("description"),
	answerType: text("answer_type").notNull().default("boolean"),
	displayOrder: integer("display_order").notNull().default(0),
	status: text("status", { enum: screeningQuestionStatusEnum }).notNull().default("draft"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	createdBy: text("created_by").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	updatedBy: text("updated_by").notNull(),
	archivedAt: timestamp("archived_at", { withTimezone: true }),
	archivedBy: text("archived_by"),
})

/** Available choices for a screening question (e.g. "Ja", "Nei", "Delvis"). */
export const screeningQuestionChoices = pgTable("screening_question_choices", {
	id: uuid("id").primaryKey().defaultRandom(),
	questionId: uuid("question_id")
		.notNull()
		.references(() => screeningQuestions.id, { onDelete: "restrict" }),
	label: text("label").notNull(),
	requiresComment: boolean("requires_comment").notNull().default(false),
	requiresLink: boolean("requires_link").notNull().default(false),
	displayOrder: integer("display_order").notNull().default(0),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	archivedAt: timestamp("archived_at", { withTimezone: true }),
	archivedBy: text("archived_by"),
})

/** What effect choosing a specific choice has on a control's compliance status. */
export const screeningChoiceEffects = pgTable("screening_choice_effects", {
	id: uuid("id").primaryKey().defaultRandom(),
	choiceId: uuid("choice_id")
		.notNull()
		.references(() => screeningQuestionChoices.id, { onDelete: "restrict" }),
	controlId: uuid("control_id")
		.notNull()
		.references(() => frameworkControls.id),
	effect: text("effect", { enum: screeningEffectEnum }),
	comment: text("comment"),
	/** When set, the routine is automatically applied during screening completion – the user cannot choose a different routine.
	 *  FK to routines.id is enforced at DB level (not in Drizzle schema to avoid circular import). */
	presetRoutineId: uuid("preset_routine_id"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	archivedAt: timestamp("archived_at", { withTimezone: true }),
	archivedBy: text("archived_by"),
})

/** Per-application answers to screening questions. */
export const screeningAnswers = pgTable(
	"screening_answers",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		applicationId: uuid("application_id")
			.notNull()
			.references(() => monitoredApplications.id, { onDelete: "restrict" }),
		questionId: uuid("question_id")
			.notNull()
			.references(() => screeningQuestions.id, { onDelete: "restrict" }),
		answer: text("answer"),
		comment: text("comment"),
		link: text("link"),
		answeredBy: text("answered_by"),
		answeredAt: timestamp("answered_at", { withTimezone: true }),
	},
	(t) => [unique().on(t.applicationId, t.questionId)],
)

// Keep old table reference for migration — will be dropped after data migration
export const screeningQuestionEffects = pgTable("screening_question_effects", {
	id: uuid("id").primaryKey().defaultRandom(),
	questionId: uuid("question_id")
		.notNull()
		.references(() => screeningQuestions.id, { onDelete: "restrict" }),
	controlId: uuid("control_id")
		.notNull()
		.references(() => frameworkControls.id),
	yesEffect: text("yes_effect", { enum: complianceStatusEnum }),
	noEffect: text("no_effect", { enum: complianceStatusEnum }),
	yesComment: text("yes_comment"),
	noComment: text("no_comment"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

/** Links screening questions to technology elements. Questions without links apply to all apps. */
export const screeningQuestionTechnologyElements = pgTable(
	"screening_question_technology_elements",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		questionId: uuid("question_id")
			.notNull()
			.references(() => screeningQuestions.id, { onDelete: "restrict" }),
		elementId: uuid("element_id")
			.notNull()
			.references(() => technologyElements.id, { onDelete: "restrict" }),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		archivedBy: text("archived_by"),
	},
	(t) => [
		uniqueIndex("uq_screening_question_tech_element_active")
			.on(t.questionId, t.elementId)
			.where(sql`${t.archivedAt} IS NULL`),
	],
)

/** Per-application routine selections from screening questions with select_routine effects. */
export const screeningRoutineSelections = pgTable(
	"screening_routine_selections",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		applicationId: uuid("application_id")
			.notNull()
			.references(() => monitoredApplications.id, { onDelete: "restrict" }),
		choiceEffectId: uuid("choice_effect_id")
			.notNull()
			.references(() => screeningChoiceEffects.id, { onDelete: "restrict" }),
		routineId: uuid("routine_id"),
		selectedBy: text("selected_by").notNull(),
		selectedAt: timestamp("selected_at", { withTimezone: true }).notNull().defaultNow(),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		archivedBy: text("archived_by"),
	},
	(t) => [
		uniqueIndex("srs_active_unique_idx").on(t.applicationId, t.choiceEffectId).where(sql`${t.archivedAt} IS NULL`),
	],
)

// ─── Screening Sessions (Instanser) ─────────────────────────────────────

export const screeningSessionStatusEnum = ["draft", "completed", "discarded"] as const
export type ScreeningSessionStatus = (typeof screeningSessionStatusEnum)[number]

/** A screening session instance that serves as audit evidence. */
export const screeningSessions = pgTable("screening_sessions", {
	id: uuid("id").primaryKey().defaultRandom(),
	applicationId: uuid("application_id")
		.notNull()
		.references(() => monitoredApplications.id, { onDelete: "restrict" }),
	title: text("title").notNull(),
	status: text("status", { enum: screeningSessionStatusEnum }).notNull().default("draft"),
	/** Snapshot of the application state (persistence, groups, oracle roles, economy) at session creation time. */
	stateSnapshot: jsonb("state_snapshot"),
	completedAt: timestamp("completed_at", { withTimezone: true }),
	completedBy: text("completed_by"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	createdBy: text("created_by").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	updatedBy: text("updated_by").notNull(),
	archivedAt: timestamp("archived_at", { withTimezone: true }),
	archivedBy: text("archived_by"),
	archiveReason: text("archive_reason"),
})

/** Participants in a screening session. */
export const screeningSessionParticipants = pgTable(
	"screening_session_participants",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sessionId: uuid("session_id")
			.notNull()
			.references(() => screeningSessions.id, { onDelete: "cascade" }),
		userIdent: text("user_ident").notNull(),
		userName: text("user_name"),
		confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		archivedBy: text("archived_by"),
	},
	(table) => [
		uniqueIndex("screening_session_participants_active_unique_idx")
			.on(table.sessionId, table.userIdent)
			.where(sql`${table.archivedAt} IS NULL`),
	],
)

/** Snapshot of answers given during a screening session (immutable audit evidence). */
export const screeningSessionAnswers = pgTable(
	"screening_session_answers",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sessionId: uuid("session_id")
			.notNull()
			.references(() => screeningSessions.id, { onDelete: "cascade" }),
		questionId: uuid("question_id")
			.notNull()
			.references(() => screeningQuestions.id, { onDelete: "restrict" }),
		answer: text("answer"),
		comment: text("comment"),
		link: text("link"),
		answeredBy: text("answered_by").notNull(),
		answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [unique().on(t.sessionId, t.questionId)],
)

// ─── Staged operations (not yet applied to application) ──────────────

export const screeningSessionOperations = pgTable("screening_session_operations", {
	id: uuid("id").primaryKey().defaultRandom(),
	sessionId: uuid("session_id")
		.notNull()
		.references(() => screeningSessions.id, { onDelete: "cascade" }),
	intent: text("intent").notNull(),
	payload: jsonb("payload").notNull(),
	performedBy: text("performed_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	replayedAt: timestamp("replayed_at", { withTimezone: true }),
})
