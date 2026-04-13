import { boolean, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"
import { monitoredApplications } from "./applications"
import { complianceStatusEnum } from "./compliance"
import { frameworkControls } from "./framework"
import { sections } from "./organization"

/** Extended effect enum that includes screening-specific effects beyond compliance statuses. */
export const screeningEffectEnum = [...complianceStatusEnum, "select_routine"] as const
export type ScreeningEffect = (typeof screeningEffectEnum)[number]

export const screeningEffectLabels: Record<string, string> = {
	not_relevant: "Ikke relevant",
	select_routine: "Velg rutine",
}

/** Screening questions shown before detailed compliance assessment. */
export const screeningQuestions = pgTable("screening_questions", {
	id: uuid("id").primaryKey().defaultRandom(),
	sectionId: uuid("section_id").references(() => sections.id, { onDelete: "cascade" }),
	questionText: text("question_text").notNull(),
	description: text("description"),
	answerType: text("answer_type").notNull().default("boolean"),
	displayOrder: integer("display_order").notNull().default(0),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	createdBy: text("created_by").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	updatedBy: text("updated_by").notNull(),
})

/** Available choices for a screening question (e.g. "Ja", "Nei", "Delvis"). */
export const screeningQuestionChoices = pgTable("screening_question_choices", {
	id: uuid("id").primaryKey().defaultRandom(),
	questionId: uuid("question_id")
		.notNull()
		.references(() => screeningQuestions.id, { onDelete: "cascade" }),
	label: text("label").notNull(),
	requiresComment: boolean("requires_comment").notNull().default(false),
	requiresLink: boolean("requires_link").notNull().default(false),
	displayOrder: integer("display_order").notNull().default(0),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

/** What effect choosing a specific choice has on a control's compliance status. */
export const screeningChoiceEffects = pgTable("screening_choice_effects", {
	id: uuid("id").primaryKey().defaultRandom(),
	choiceId: uuid("choice_id")
		.notNull()
		.references(() => screeningQuestionChoices.id, { onDelete: "cascade" }),
	controlId: uuid("control_id")
		.notNull()
		.references(() => frameworkControls.id),
	effect: text("effect", { enum: screeningEffectEnum }),
	comment: text("comment"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

/** Per-application answers to screening questions. */
export const screeningAnswers = pgTable(
	"screening_answers",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		applicationId: uuid("application_id")
			.notNull()
			.references(() => monitoredApplications.id),
		questionId: uuid("question_id")
			.notNull()
			.references(() => screeningQuestions.id, { onDelete: "cascade" }),
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
		.references(() => screeningQuestions.id, { onDelete: "cascade" }),
	controlId: uuid("control_id")
		.notNull()
		.references(() => frameworkControls.id),
	yesEffect: text("yes_effect", { enum: complianceStatusEnum }),
	noEffect: text("no_effect", { enum: complianceStatusEnum }),
	yesComment: text("yes_comment"),
	noComment: text("no_comment"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

/** Per-application routine selections from screening questions with select_routine effects. */
export const screeningRoutineSelections = pgTable(
	"screening_routine_selections",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		applicationId: uuid("application_id")
			.notNull()
			.references(() => monitoredApplications.id),
		choiceEffectId: uuid("choice_effect_id")
			.notNull()
			.references(() => screeningChoiceEffects.id, { onDelete: "cascade" }),
		routineId: uuid("routine_id"),
		selectedBy: text("selected_by").notNull(),
		selectedAt: timestamp("selected_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [unique().on(t.applicationId, t.choiceEffectId)],
)
