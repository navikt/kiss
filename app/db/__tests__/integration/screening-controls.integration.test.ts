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

const { getScreeningDerivedControlIds, getBatchScreeningDerivedControlIds } = await import(
	"~/db/queries/screening.server"
)
const { getAppAssessments } = await import("~/db/queries/applications.server")

let sectionId: string
let appId: string
let controlA: string
let controlB: string
let controlC: string

async function rawInsert(table: string, values: Record<string, unknown>): Promise<string> {
	const db = getTestDb()
	const cols = Object.keys(values).join(", ")
	const vals = Object.values(values)
		.map((v) => (v === null ? "NULL" : `'${v}'`))
		.join(", ")
	const result = await db.execute(/* sql */ `INSERT INTO ${table} (${cols}) VALUES (${vals}) RETURNING id`)
	return (result.rows[0] as { id: string }).id
}

async function rawExec(sql: string) {
	const db = getTestDb()
	await db.execute(sql)
}

describe("screening-derived control IDs", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		// Clean up in dependency order
		await db.execute("DELETE FROM screening_routine_selections")
		await db.execute("DELETE FROM screening_answers")
		await db.execute("DELETE FROM screening_choice_effects")
		await db.execute("DELETE FROM screening_question_choices")
		await db.execute("DELETE FROM screening_questions")
		await db.execute("DELETE FROM routine_controls")
		await db.execute("DELETE FROM ruleset_controls")
		await db.execute("DELETE FROM rulesets")
		await db.execute("DELETE FROM routines")
		await db.execute("DELETE FROM compliance_assessments")
		await db.execute("DELETE FROM framework_risk_control_mappings")
		await db.execute("DELETE FROM control_technology_elements")
		await db.execute("DELETE FROM framework_controls")
		await db.execute("DELETE FROM framework_risks")
		await db.execute("DELETE FROM framework_domains")
		await db.execute("DELETE FROM monitored_applications")
		await db.execute("DELETE FROM dev_teams")
		await db.execute("DELETE FROM sections")

		// Create base data
		sectionId = await rawInsert("sections", {
			name: "Test Section",
			slug: "test-section",
			created_by: "test",
			updated_by: "test",
		})

		appId = await rawInsert("monitored_applications", {
			name: "TestApp",
			created_by: "test",
			updated_by: "test",
		})

		// Create a domain
		const domainId = await rawInsert("framework_domains", {
			code: "TS",
			name: "Teknisk sikkerhet",
		})

		// Create 3 controls
		controlA = await rawInsert("framework_controls", {
			control_id: "K-TS.01",
			short_title: "Control A",
			requirement: "Req A",
		})
		controlB = await rawInsert("framework_controls", {
			control_id: "K-TS.02",
			short_title: "Control B",
			requirement: "Req B",
		})
		controlC = await rawInsert("framework_controls", {
			control_id: "K-TS.03",
			short_title: "Control C",
			requirement: "Req C",
		})

		// Create risks linked to controls (for domain derivation)
		const riskId = await rawInsert("framework_risks", {
			risk_id: "R-TS.01",
			description: "Test risk",
			domain_id: domainId,
		})
		await rawExec(
			`INSERT INTO framework_risk_control_mappings (risk_id, control_id) VALUES ('${riskId}', '${controlA}'), ('${riskId}', '${controlB}'), ('${riskId}', '${controlC}')`,
		)
	})

	it("returns empty set when no screening answers exist", async () => {
		const result = await getScreeningDerivedControlIds(appId)
		expect(result.size).toBe(0)
	})

	it("returns controls from direct choice effects (path 1)", async () => {
		// Create question → choice → effect → controlA
		const questionId = await rawInsert("screening_questions", {
			question_text: "Test question?",
			answer_type: "boolean",
			display_order: 1,
			created_by: "test",
			updated_by: "test",
		})
		const choiceId = await rawInsert("screening_question_choices", {
			question_id: questionId,
			label: "Ja",
			display_order: 1,
		})
		await rawInsert("screening_choice_effects", {
			choice_id: choiceId,
			control_id: controlA,
			effect: "implemented",
		})

		// Answer the question
		await rawInsert("screening_answers", {
			application_id: appId,
			question_id: questionId,
			answer: "Ja",
			answered_by: "test",
			answered_at: new Date().toISOString(),
		})

		const result = await getScreeningDerivedControlIds(appId)
		expect(result.size).toBe(1)
		expect(result.has(controlA)).toBe(true)
	})

	it("returns controls from selected routines (path 2)", async () => {
		// Create routine with controlB linked
		const routineId = await rawInsert("routines", {
			name: "Test Routine",
			section_id: sectionId,
			frequency: "quarterly",
			created_by: "test",
			updated_by: "test",
		})
		await rawExec(`INSERT INTO routine_controls (routine_id, control_id) VALUES ('${routineId}', '${controlB}')`)

		// Create question → choice → select_routine effect
		const questionId = await rawInsert("screening_questions", {
			question_text: "Select routine?",
			answer_type: "boolean",
			display_order: 1,
			created_by: "test",
			updated_by: "test",
		})
		const choiceId = await rawInsert("screening_question_choices", {
			question_id: questionId,
			label: "Ja",
			display_order: 1,
		})
		const effectId = await rawInsert("screening_choice_effects", {
			choice_id: choiceId,
			control_id: controlB,
			effect: "select_routine",
		})

		// Answer the question
		await rawInsert("screening_answers", {
			application_id: appId,
			question_id: questionId,
			answer: "Ja",
			answered_by: "test",
			answered_at: new Date().toISOString(),
		})

		// Select routine
		await rawInsert("screening_routine_selections", {
			application_id: appId,
			choice_effect_id: effectId,
			routine_id: routineId,
			selected_by: "test",
			selected_at: new Date().toISOString(),
		})

		const result = await getScreeningDerivedControlIds(appId)
		expect(result.has(controlB)).toBe(true)
	})

	it("returns controls from rulesets (path 3)", async () => {
		// Create ruleset with controlC linked
		const rulesetId = await rawInsert("rulesets", {
			name: "Test Ruleset",
			section_id: sectionId,
			frequency: "quarterly",
			status: "active",
			created_by: "test",
			updated_by: "test",
		})
		await rawExec(`INSERT INTO ruleset_controls (ruleset_id, control_id) VALUES ('${rulesetId}', '${controlC}')`)

		// Create question linked to ruleset
		const questionId = await rawInsert("screening_questions", {
			question_text: "Ruleset question?",
			answer_type: "boolean",
			ruleset_id: rulesetId,
			display_order: 1,
			created_by: "test",
			updated_by: "test",
		})

		// Answer the question
		await rawInsert("screening_answers", {
			application_id: appId,
			question_id: questionId,
			answer: "Yes",
			answered_by: "test",
			answered_at: new Date().toISOString(),
		})

		const result = await getScreeningDerivedControlIds(appId)
		expect(result.has(controlC)).toBe(true)
	})

	it("returns union of all 3 paths", async () => {
		// Path 1: direct effect → controlA
		const q1 = await rawInsert("screening_questions", {
			question_text: "Q1?",
			answer_type: "boolean",
			display_order: 1,
			created_by: "test",
			updated_by: "test",
		})
		const c1 = await rawInsert("screening_question_choices", {
			question_id: q1,
			label: "Ja",
			display_order: 1,
		})
		await rawInsert("screening_choice_effects", {
			choice_id: c1,
			control_id: controlA,
			effect: "implemented",
		})
		await rawInsert("screening_answers", {
			application_id: appId,
			question_id: q1,
			answer: "Ja",
			answered_by: "test",
			answered_at: new Date().toISOString(),
		})

		// Path 2: routine → controlB
		const routineId = await rawInsert("routines", {
			name: "R1",
			section_id: sectionId,
			frequency: "quarterly",
			created_by: "test",
			updated_by: "test",
		})
		await rawExec(`INSERT INTO routine_controls (routine_id, control_id) VALUES ('${routineId}', '${controlB}')`)
		const q2 = await rawInsert("screening_questions", {
			question_text: "Q2?",
			answer_type: "boolean",
			display_order: 2,
			created_by: "test",
			updated_by: "test",
		})
		const c2 = await rawInsert("screening_question_choices", {
			question_id: q2,
			label: "Ja",
			display_order: 1,
		})
		const eff2 = await rawInsert("screening_choice_effects", {
			choice_id: c2,
			control_id: controlB,
			effect: "select_routine",
		})
		await rawInsert("screening_answers", {
			application_id: appId,
			question_id: q2,
			answer: "Ja",
			answered_by: "test",
			answered_at: new Date().toISOString(),
		})
		await rawInsert("screening_routine_selections", {
			application_id: appId,
			choice_effect_id: eff2,
			routine_id: routineId,
			selected_by: "test",
			selected_at: new Date().toISOString(),
		})

		// Path 3: ruleset → controlC
		const rulesetId = await rawInsert("rulesets", {
			name: "RS1",
			section_id: sectionId,
			frequency: "quarterly",
			status: "active",
			created_by: "test",
			updated_by: "test",
		})
		await rawExec(`INSERT INTO ruleset_controls (ruleset_id, control_id) VALUES ('${rulesetId}', '${controlC}')`)
		const q3 = await rawInsert("screening_questions", {
			question_text: "Q3?",
			answer_type: "boolean",
			ruleset_id: rulesetId,
			display_order: 3,
			created_by: "test",
			updated_by: "test",
		})
		await rawInsert("screening_answers", {
			application_id: appId,
			question_id: q3,
			answer: "Yes",
			answered_by: "test",
			answered_at: new Date().toISOString(),
		})

		const result = await getScreeningDerivedControlIds(appId)
		expect(result.size).toBe(3)
		expect(result.has(controlA)).toBe(true)
		expect(result.has(controlB)).toBe(true)
		expect(result.has(controlC)).toBe(true)
	})

	it("getAppAssessments returns all controls when no screening (fallback)", async () => {
		const result = await getAppAssessments(appId)
		expect(result).not.toBeNull()
		// Without screening, all 3 controls should show (no tech element filtering)
		expect(result?.assessments.length).toBe(3)
		expect(result?.hasScreeningAnswers).toBe(false)
		// All controls should have their actual status (no screening override)
		for (const a of result?.assessments ?? []) {
			expect(a.isScreeningDerived).toBe(true)
		}
	})

	it("getAppAssessments shows all controls but forces null status for non-screening controls", async () => {
		// Create question → choice → effect → controlA only
		const questionId = await rawInsert("screening_questions", {
			question_text: "Filter test?",
			answer_type: "boolean",
			display_order: 1,
			created_by: "test",
			updated_by: "test",
		})
		const choiceId = await rawInsert("screening_question_choices", {
			question_id: questionId,
			label: "Ja",
			display_order: 1,
		})
		await rawInsert("screening_choice_effects", {
			choice_id: choiceId,
			control_id: controlA,
			effect: "implemented",
		})
		await rawInsert("screening_answers", {
			application_id: appId,
			question_id: questionId,
			answer: "Ja",
			answered_by: "test",
			answered_at: new Date().toISOString(),
		})

		const result = await getAppAssessments(appId)
		expect(result).not.toBeNull()
		expect(result?.hasScreeningAnswers).toBe(true)
		// All 3 controls should appear (not filtered out)
		expect(result?.assessments.length).toBe(3)
		// controlA is screening-derived
		const asmtA = result?.assessments.find((a) => a.controlId === "K-TS.01")
		expect(asmtA?.isScreeningDerived).toBe(true)
		// controlB and controlC are NOT screening-derived → forced to null
		const asmtB = result?.assessments.find((a) => a.controlId === "K-TS.02")
		expect(asmtB?.isScreeningDerived).toBe(false)
		expect(asmtB?.status).toBeNull()
		const asmtC = result?.assessments.find((a) => a.controlId === "K-TS.03")
		expect(asmtC?.isScreeningDerived).toBe(false)
		expect(asmtC?.status).toBeNull()
	})

	it("batch function returns correct controls per app", async () => {
		// App1 (appId) has no screening answers → empty set
		// Create a second app with screening answers
		const app2Id = await rawInsert("monitored_applications", {
			name: "TestApp2",
			created_by: "test",
			updated_by: "test",
		})
		const questionId = await rawInsert("screening_questions", {
			question_text: "Batch test?",
			answer_type: "boolean",
			display_order: 1,
			created_by: "test",
			updated_by: "test",
		})
		const choiceId = await rawInsert("screening_question_choices", {
			question_id: questionId,
			label: "Ja",
			display_order: 1,
		})
		await rawInsert("screening_choice_effects", {
			choice_id: choiceId,
			control_id: controlA,
			effect: "not_implemented",
		})
		await rawInsert("screening_answers", {
			application_id: app2Id,
			question_id: questionId,
			answer: "Ja",
			answered_by: "test",
			answered_at: new Date().toISOString(),
		})

		const result = await getBatchScreeningDerivedControlIds([appId, app2Id])
		// appId has no answers → empty set
		expect(result.get(appId)?.size).toBe(0)
		// app2Id has answer linking to controlA
		expect(result.get(app2Id)?.size).toBe(1)
		expect(result.get(app2Id)?.has(controlA)).toBe(true)
	})
})
