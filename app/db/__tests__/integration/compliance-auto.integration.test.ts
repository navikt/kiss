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

const { getScreeningEffectsByControlForApp } = await import("~/db/queries/compliance-auto.server")

async function rawInsert(table: string, values: Record<string, unknown>): Promise<string> {
	const db = getTestDb()
	const cols = Object.keys(values).join(", ")
	const vals = Object.values(values)
		.map((v) => (v === null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`))
		.join(", ")
	const r = await db.execute(/* sql */ `INSERT INTO ${table} (${cols}) VALUES (${vals}) RETURNING id`)
	return (r.rows[0] as { id: string }).id
}

async function rawExec(sql: string) {
	const db = getTestDb()
	await db.execute(sql)
}

let appId: string
let sectionId: string
let naisTeamId: string
let controlA: string
let controlB: string

describe("compliance-auto.server integration tests", () => {
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
			DELETE FROM screening_question_technology_elements;
			DELETE FROM screening_questions;
			DELETE FROM application_technology_elements;
			DELETE FROM technology_elements;
			DELETE FROM application_environments;
			DELETE FROM nais_teams;
			DELETE FROM monitored_applications;
			DELETE FROM framework_controls;
			DELETE FROM sections;
		`)

		sectionId = await rawInsert("sections", {
			name: "Sec",
			slug: "sec",
			created_by: "test",
			updated_by: "test",
		})
		appId = await rawInsert("monitored_applications", {
			name: "App1",
			created_by: "test",
			updated_by: "test",
		})
		naisTeamId = await rawInsert("nais_teams", { slug: "team-a", section_id: sectionId, status: "monitored" })
		await rawExec(
			`INSERT INTO application_environments (application_id, cluster, namespace, nais_team_id) VALUES ('${appId}', 'dev-gcp', 'team-a', '${naisTeamId}')`,
		)
		controlA = await rawInsert("framework_controls", { control_id: "K-A.01", requirement: "A" })
		controlB = await rawInsert("framework_controls", { control_id: "K-B.01", requirement: "B" })
	})

	it("returns empty map when there are no screening questions", async () => {
		const result = await getScreeningEffectsByControlForApp(appId)
		expect(result.size).toBe(0)
	})

	it("returns empty effects with allQuestionsAnswered=false when question is not answered", async () => {
		const questionId = await rawInsert("screening_questions", {
			question_text: "MFA?",
			created_by: "admin",
			updated_by: "admin",
		})
		const choiceJa = await rawInsert("screening_question_choices", { question_id: questionId, label: "Ja" })
		await rawInsert("screening_choice_effects", {
			choice_id: choiceJa,
			control_id: controlA,
			effect: "implemented",
		})

		const result = await getScreeningEffectsByControlForApp(appId)
		const entry = result.get(controlA)
		expect(entry).toBeDefined()
		expect(entry?.hasQuestions).toBe(true)
		expect(entry?.allQuestionsAnswered).toBe(false)
		expect(entry?.effects).toEqual([])
	})

	it("returns the matching effect when the user answered with the choice that triggers it", async () => {
		const questionId = await rawInsert("screening_questions", {
			question_text: "MFA?",
			created_by: "admin",
			updated_by: "admin",
		})
		const choiceJa = await rawInsert("screening_question_choices", { question_id: questionId, label: "Ja" })
		await rawInsert("screening_question_choices", { question_id: questionId, label: "Nei" })
		await rawInsert("screening_choice_effects", {
			choice_id: choiceJa,
			control_id: controlA,
			effect: "implemented",
		})
		await rawExec(
			`INSERT INTO screening_answers (application_id, question_id, answer, answered_by) VALUES ('${appId}', '${questionId}', 'Ja', 'X1')`,
		)

		const result = await getScreeningEffectsByControlForApp(appId)
		const entry = result.get(controlA)
		expect(entry).toBeDefined()
		expect(entry?.allQuestionsAnswered).toBe(true)
		expect(entry?.effects).toEqual(["implemented"])
	})

	it("does not include 'select_routine' as an effect", async () => {
		const questionId = await rawInsert("screening_questions", {
			question_text: "Need routine?",
			created_by: "admin",
			updated_by: "admin",
		})
		const choiceJa = await rawInsert("screening_question_choices", { question_id: questionId, label: "Ja" })
		await rawInsert("screening_choice_effects", {
			choice_id: choiceJa,
			control_id: controlA,
			effect: "select_routine",
		})
		await rawExec(
			`INSERT INTO screening_answers (application_id, question_id, answer, answered_by) VALUES ('${appId}', '${questionId}', 'Ja', 'X1')`,
		)

		const result = await getScreeningEffectsByControlForApp(appId)
		expect(result.has(controlA)).toBe(false)
	})

	it("filters questions to the app's section (global + section-scoped)", async () => {
		const otherSection = await rawInsert("sections", {
			name: "OtherSec",
			slug: "other-sec",
			created_by: "t",
			updated_by: "t",
		})

		// Section-scoped question for the OTHER section: must be excluded
		const qOther = await rawInsert("screening_questions", {
			question_text: "Other?",
			section_id: otherSection,
			created_by: "admin",
			updated_by: "admin",
		})
		const cOther = await rawInsert("screening_question_choices", { question_id: qOther, label: "Ja" })
		await rawInsert("screening_choice_effects", { choice_id: cOther, control_id: controlA, effect: "implemented" })

		// Section-scoped question for OUR section: must be included
		const qOurs = await rawInsert("screening_questions", {
			question_text: "Ours?",
			section_id: sectionId,
			created_by: "admin",
			updated_by: "admin",
		})
		const cOurs = await rawInsert("screening_question_choices", { question_id: qOurs, label: "Ja" })
		await rawInsert("screening_choice_effects", { choice_id: cOurs, control_id: controlB, effect: "implemented" })
		await rawExec(
			`INSERT INTO screening_answers (application_id, question_id, answer, answered_by) VALUES ('${appId}', '${qOurs}', 'Ja', 'X1')`,
		)

		const result = await getScreeningEffectsByControlForApp(appId)
		expect(result.has(controlA)).toBe(false)
		expect(result.get(controlB)?.effects).toEqual(["implemented"])
	})

	it("filters questions by required technology elements (excludes when app lacks the tech)", async () => {
		const elementId = await rawInsert("technology_elements", { name: "Kubernetes", slug: "kubernetes" })

		const questionId = await rawInsert("screening_questions", {
			question_text: "K8s relevant?",
			created_by: "admin",
			updated_by: "admin",
		})
		await rawExec(
			`INSERT INTO screening_question_technology_elements (question_id, element_id) VALUES ('${questionId}', '${elementId}')`,
		)
		const choice = await rawInsert("screening_question_choices", { question_id: questionId, label: "Ja" })
		await rawInsert("screening_choice_effects", { choice_id: choice, control_id: controlA, effect: "implemented" })
		await rawExec(
			`INSERT INTO screening_answers (application_id, question_id, answer, answered_by) VALUES ('${appId}', '${questionId}', 'Ja', 'X1')`,
		)

		// App does NOT have the tech element confirmed → question filtered out
		let result = await getScreeningEffectsByControlForApp(appId)
		expect(result.has(controlA)).toBe(false)

		// Confirm the tech element on the app
		await rawExec(
			`INSERT INTO application_technology_elements (application_id, element_id, source, confirmed_at, confirmed_by) VALUES ('${appId}', '${elementId}', 'manual', NOW(), 'tester')`,
		)

		result = await getScreeningEffectsByControlForApp(appId)
		expect(result.get(controlA)?.effects).toEqual(["implemented"])
	})

	it("marks allQuestionsAnswered=false when only some questions affecting a control are answered", async () => {
		const q1 = await rawInsert("screening_questions", {
			question_text: "Q1",
			created_by: "admin",
			updated_by: "admin",
		})
		const c1 = await rawInsert("screening_question_choices", { question_id: q1, label: "Ja" })
		await rawInsert("screening_choice_effects", { choice_id: c1, control_id: controlA, effect: "implemented" })

		const q2 = await rawInsert("screening_questions", {
			question_text: "Q2",
			created_by: "admin",
			updated_by: "admin",
		})
		const c2 = await rawInsert("screening_question_choices", { question_id: q2, label: "Ja" })
		await rawInsert("screening_choice_effects", { choice_id: c2, control_id: controlA, effect: "implemented" })

		// Only answer q1
		await rawExec(
			`INSERT INTO screening_answers (application_id, question_id, answer, answered_by) VALUES ('${appId}', '${q1}', 'Ja', 'X')`,
		)

		const result = await getScreeningEffectsByControlForApp(appId)
		const entry = result.get(controlA)
		expect(entry?.allQuestionsAnswered).toBe(false)
		expect(entry?.effects).toEqual(["implemented"])
	})
})
