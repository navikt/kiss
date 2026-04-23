import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { getTestDb, setupTestDatabase, teardownTestDatabase } from "./setup"

vi.mock("~/db/connection.server", () => ({
	get db() {
		return getTestDb()
	},
	get pool() {
		return null
	},
}))

const {
	createScreeningQuestion,
	updateScreeningQuestion,
	archiveScreeningQuestion,
	unarchiveScreeningQuestion,
	reorderScreeningQuestions,
	getScreeningQuestions,
	getSectionScreeningQuestions,
	getChoicesForQuestion,
	createChoice,
	updateChoice,
	archiveChoice,
	unarchiveChoice,
	addChoiceEffect,
	getChoiceEffects,
	archiveChoiceEffect,
	unarchiveChoiceEffect,
	saveScreeningAnswer,
	getScreeningAnswersForApp,
	setQuestionTechnologyElements,
	getQuestionTechnologyElements,
} = await import("~/db/queries/screening.server")

async function createApp(name: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `INSERT INTO monitored_applications (name, created_by, updated_by) VALUES ('${name}', 'test', 'test') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function createSectionRow(slug: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('Sec ${slug}', '${slug}', 'test', 'test') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function createControl(controlId: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `INSERT INTO framework_controls (control_id, requirement) VALUES ('${controlId}', 'req') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function createTechElement(slug: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `INSERT INTO technology_elements (name, slug) VALUES ('${slug}', '${slug}') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function getAuditByAction(action: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `SELECT action, entity_id, performed_by, new_value FROM audit_log WHERE action = '${action}'`,
	)
	return r.rows as Array<{ action: string; entity_id: string; performed_by: string; new_value: string | null }>
}

describe("screening.server integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM screening_routine_selections;
			DELETE FROM screening_answers;
			DELETE FROM screening_choice_effects;
			DELETE FROM screening_question_choices;
			DELETE FROM screening_question_effects;
			DELETE FROM screening_question_technology_elements;
			DELETE FROM screening_questions;
			DELETE FROM technology_elements;
			DELETE FROM framework_controls;
			DELETE FROM monitored_applications;
			DELETE FROM sections;
			DELETE FROM audit_log;
		`)
	})

	describe("Questions CRUD", () => {
		it("auto-creates Ja/Nei choices for a boolean question and writes audit log", async () => {
			const q = await createScreeningQuestion("Brukes MFA?", "Beskrivelse", 0, "admin")
			expect(q.questionText).toBe("Brukes MFA?")

			const choices = await getChoicesForQuestion(q.id)
			expect(choices.map((c) => c.label)).toEqual(["Ja", "Nei"])

			const audit = await getAuditByAction("screening_question_created")
			expect(audit.find((a) => a.entity_id === q.id)).toBeDefined()
		})

		it("does not auto-create choices for non-boolean questions", async () => {
			const q = await createScreeningQuestion("Hva er verdi?", null, 0, "admin", null, "text")
			const choices = await getChoicesForQuestion(q.id)
			expect(choices).toHaveLength(0)
		})

		it("scopes questions to a section", async () => {
			const sectionId = await createSectionRow("sec1")
			await createScreeningQuestion("Global?", null, 0, "admin")
			await createScreeningQuestion("Sec scoped?", null, 0, "admin", sectionId)

			const globals = await getScreeningQuestions()
			const sectionQs = await getSectionScreeningQuestions(sectionId)
			expect(globals).toHaveLength(1)
			expect(globals[0].questionText).toBe("Global?")
			expect(sectionQs).toHaveLength(1)
			expect(sectionQs[0].questionText).toBe("Sec scoped?")
		})

		it("updates a question with audit log", async () => {
			const q = await createScreeningQuestion("Old?", null, 0, "admin")
			const updated = await updateScreeningQuestion(q.id, "New?", "desc", 1, "editor")
			expect(updated.questionText).toBe("New?")
			expect(updated.displayOrder).toBe(1)

			const audit = await getAuditByAction("screening_question_updated")
			expect(audit.find((a) => a.entity_id === q.id)?.new_value).toBe("New?")
		})

		it("reorders questions", async () => {
			const a = await createScreeningQuestion("A", null, 0, "admin")
			const b = await createScreeningQuestion("B", null, 1, "admin")
			const c = await createScreeningQuestion("C", null, 2, "admin")

			await reorderScreeningQuestions([c.id, a.id, b.id], "admin")

			const all = await getScreeningQuestions()
			expect(all.map((q) => q.questionText)).toEqual(["C", "A", "B"])
		})

		it("archives a question (soft-delete) with audit log and supports unarchive", async () => {
			const q = await createScreeningQuestion("ToArchive", null, 0, "admin")
			await archiveScreeningQuestion(q.id, "admin")

			// Default lookup hides archived
			const visible = await getScreeningQuestions()
			expect(visible.find((x) => x.id === q.id)).toBeUndefined()

			// includeArchived shows them
			const all = await getScreeningQuestions({ includeArchived: true })
			const archived = all.find((x) => x.id === q.id)
			expect(archived).toBeDefined()
			expect(archived?.archivedAt).not.toBeNull()
			expect(archived?.archivedBy).toBe("admin")

			const audit = await getAuditByAction("screening_question_archived")
			expect(audit.find((a) => a.entity_id === q.id)).toBeDefined()

			// Idempotent: archiving twice should not produce a second audit entry
			await archiveScreeningQuestion(q.id, "admin")
			const auditAgain = await getAuditByAction("screening_question_archived")
			expect(auditAgain.filter((a) => a.entity_id === q.id)).toHaveLength(1)

			// Unarchive
			await unarchiveScreeningQuestion(q.id, "admin")
			const visibleAfter = await getScreeningQuestions()
			expect(visibleAfter.find((x) => x.id === q.id)).toBeDefined()

			const unarchiveAudit = await getAuditByAction("screening_question_unarchived")
			expect(unarchiveAudit.find((a) => a.entity_id === q.id)).toBeDefined()
		})

		it("returns null when archiving a missing question", async () => {
			const result = await archiveScreeningQuestion("00000000-0000-0000-0000-000000000000", "admin")
			expect(result).toBeNull()
		})
	})

	describe("Choices CRUD", () => {
		it("creates, updates and archives choices", async () => {
			const q = await createScreeningQuestion("Q", null, 0, "admin", null, "single")
			const choice = await createChoice({ questionId: q.id, label: "Maybe", displayOrder: 0 })
			expect(choice.label).toBe("Maybe")

			const updated = await updateChoice(choice.id, { label: "Possibly", requiresComment: true })
			expect(updated.label).toBe("Possibly")
			expect(updated.requiresComment).toBe(true)

			await archiveChoice(choice.id, "admin")
			const remaining = await getChoicesForQuestion(q.id)
			expect(remaining).toHaveLength(0)

			const all = await getChoicesForQuestion(q.id, { includeArchived: true })
			expect(all).toHaveLength(1)
			expect(all[0].archivedAt).not.toBeNull()

			const audit = await getAuditByAction("screening_choice_archived")
			expect(audit.find((a) => a.entity_id === choice.id)).toBeDefined()

			// Idempotent
			await archiveChoice(choice.id, "admin")
			const auditAgain = await getAuditByAction("screening_choice_archived")
			expect(auditAgain.filter((a) => a.entity_id === choice.id)).toHaveLength(1)

			// Unarchive
			await unarchiveChoice(choice.id, "admin")
			const remainingAfter = await getChoicesForQuestion(q.id)
			expect(remainingAfter).toHaveLength(1)
		})

		it("cascade-archives child effects when choice is archived (with audit entries)", async () => {
			const q = await createScreeningQuestion("Q?", null, 0, "admin")
			const choices = await getChoicesForQuestion(q.id)
			const ja = choices.find((c) => c.label === "Ja")!
			await createControl("K-CASCADE.01")
			const eff = await addChoiceEffect({
				choiceId: ja.id,
				controlTextId: "K-CASCADE.01",
				effect: "implemented",
				comment: null,
			})

			// Confirm effect is active before archiving choice
			expect(await getChoiceEffects(ja.id)).toHaveLength(1)

			await archiveChoice(ja.id, "admin")

			// Choice is archived
			const archivedChoice = (await getChoicesForQuestion(q.id, { includeArchived: true })).find((c) => c.id === ja.id)
			expect(archivedChoice?.archivedAt).not.toBeNull()

			// Effect should also be archived
			expect(await getChoiceEffects(ja.id)).toHaveLength(0)
			const effectsIncludingArchived = await getChoiceEffects(ja.id, { includeArchived: true })
			expect(effectsIncludingArchived).toHaveLength(1)
			expect(effectsIncludingArchived[0].archivedAt).not.toBeNull()

			// Audit entry exists for cascaded effect
			const effAudit = await getAuditByAction("screening_choice_effect_archived")
			expect(effAudit.find((a) => a.entity_id === eff.id)).toBeDefined()
		})
	})

	describe("Choice effects", () => {
		it("adds and lists choice effects with control text id", async () => {
			const q = await createScreeningQuestion("Q?", null, 0, "admin")
			const choices = await getChoicesForQuestion(q.id)
			const ja = choices.find((c) => c.label === "Ja")
			expect(ja).toBeDefined()
			await createControl("K-S.01")

			const eff = await addChoiceEffect({
				choiceId: ja!.id,
				controlTextId: "K-S.01",
				effect: "implemented",
				comment: "Godkjent gjennom MFA",
			})
			expect(eff.effect).toBe("implemented")

			const list = await getChoiceEffects(ja!.id)
			expect(list).toHaveLength(1)
			expect(list[0].controlTextId).toBe("K-S.01")

			await archiveChoiceEffect(eff.id, "admin")
			const empty = await getChoiceEffects(ja!.id)
			expect(empty).toHaveLength(0)

			const all = await getChoiceEffects(ja!.id, { includeArchived: true })
			expect(all).toHaveLength(1)
			expect(all[0].archivedAt).not.toBeNull()

			const audit = await getAuditByAction("screening_choice_effect_archived")
			expect(audit.find((a) => a.entity_id === eff.id)).toBeDefined()

			// Unarchive
			await unarchiveChoiceEffect(eff.id, "admin")
			const after = await getChoiceEffects(ja!.id)
			expect(after).toHaveLength(1)
		})

		it("throws if control text id does not exist", async () => {
			const q = await createScreeningQuestion("Q?", null, 0, "admin")
			const choices = await getChoicesForQuestion(q.id)
			await expect(
				addChoiceEffect({
					choiceId: choices[0].id,
					controlTextId: "K-NONE.99",
					effect: "implemented",
					comment: null,
				}),
			).rejects.toThrow(/ikke funnet/)
		})
	})

	describe("Tech element scoping", () => {
		it("sets and replaces technology elements for a question", async () => {
			const q = await createScreeningQuestion("Q?", null, 0, "admin")
			const e1 = await createTechElement("kubernetes")
			const e2 = await createTechElement("postgres")

			await setQuestionTechnologyElements(q.id, [e1, e2])
			let links = await getQuestionTechnologyElements(q.id)
			expect(links.map((l) => l.elementId).sort()).toEqual([e1, e2].sort())

			await setQuestionTechnologyElements(q.id, [e2])
			links = await getQuestionTechnologyElements(q.id)
			expect(links.map((l) => l.elementId)).toEqual([e2])

			await setQuestionTechnologyElements(q.id, [])
			links = await getQuestionTechnologyElements(q.id)
			expect(links).toHaveLength(0)
		})
	})

	describe("Answers", () => {
		it("upserts an answer and writes audit log", async () => {
			const app = await createApp("App1")
			const q = await createScreeningQuestion("Q?", null, 0, "admin")

			await saveScreeningAnswer(app, q.id, "Ja", "X1", "kommentar", "https://example.com")

			let answers = await getScreeningAnswersForApp(app)
			expect(answers).toHaveLength(1)
			expect(answers[0].answer).toBe("Ja")
			expect(answers[0].comment).toBe("kommentar")
			expect(answers[0].link).toBe("https://example.com")

			// upsert: changes existing answer
			await saveScreeningAnswer(app, q.id, "Nei", "X2", null, null)
			answers = await getScreeningAnswersForApp(app)
			expect(answers).toHaveLength(1)
			expect(answers[0].answer).toBe("Nei")
			expect(answers[0].comment).toBeNull()

			const audit = await getAuditByAction("screening_answer_saved")
			expect(audit.length).toBeGreaterThanOrEqual(2)
			const entityIds = audit.map((a) => a.entity_id)
			expect(entityIds).toContain(`${app}/${q.id}`)
		})
	})
})
