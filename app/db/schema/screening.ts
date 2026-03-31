import { boolean, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"
import { monitoredApplications } from "./applications"
import { complianceStatusEnum } from "./compliance"
import { frameworkControls } from "./framework"

/** Yes/No screening questions shown before detailed compliance assessment. */
export const screeningQuestions = pgTable("screening_questions", {
	id: uuid("id").primaryKey().defaultRandom(),
	questionText: text("question_text").notNull(),
	description: text("description"),
	displayOrder: integer("display_order").notNull().default(0),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	createdBy: text("created_by").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	updatedBy: text("updated_by").notNull(),
})

/** What effect a yes/no answer has on a specific control's compliance status. */
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
		answer: boolean("answer"),
		answeredBy: text("answered_by"),
		answeredAt: timestamp("answered_at", { withTimezone: true }),
	},
	(t) => [unique().on(t.applicationId, t.questionId)],
)
