import { describe, expect, it } from "vitest"
import { computeAutoCompliance, mergeScreeningEffects } from "../auto-compliance"

const makeAssessment = (
	controlUuid: string,
	technologyElementId: string | null,
	status: "not_relevant" | "not_implemented" | "partially_implemented" | "implemented" | null = null,
) => ({
	controlUuid,
	technologyElementId,
	status,
})

const makeDeadline = (
	routineId: string,
	controlIds: string[],
	matchSource: "screening" | "persistence" | "group_classification" | "screening_selection" | "section",
	overdue = false,
	lastReviewDate: Date | null = new Date(),
	technologyElementIds: string[] = [],
) => ({
	routine: {
		id: routineId,
		controls: controlIds.map((id) => ({ id })),
		technologyElementIds,
	},
	matchSource,
	overdue,
	lastReviewDate,
})

const makeScreening = (effects: string[], allQuestionsAnswered: boolean, hasQuestions = true) => ({
	effects,
	allQuestionsAnswered,
	hasQuestions,
	details: effects.map((e, i) => ({ questionId: `q-${i}`, questionTitle: "Test-spørsmål", answer: "Ja", effect: e })),
})

describe("computeAutoCompliance", () => {
	it("returns null when no routines and no screening", () => {
		const assessments = [makeAssessment("ctrl-1", null)]
		const screeningEffects = new Map()

		const result = computeAutoCompliance(assessments, [], screeningEffects)
		const auto = result.get("ctrl-1:null")

		expect(auto).toBeDefined()
		expect(auto?.autoStatus).toBeNull()
		expect(auto?.reason).toContain("Ingen rutiner eller screeningspørsmål")
	})

	it("returns 'not_relevant' when screening says not_relevant and no routines match", () => {
		const assessments = [makeAssessment("ctrl-1", null)]
		const screeningEffects = new Map([["ctrl-1:all", makeScreening(["not_relevant"], true)]])

		const result = computeAutoCompliance(assessments, [], screeningEffects)
		expect(result.get("ctrl-1:null")?.autoStatus).toBe("not_relevant")
	})

	it("returns null when screening questions are not yet answered", () => {
		const assessments = [makeAssessment("ctrl-1", null)]
		const screeningEffects = new Map([["ctrl-1:all", makeScreening([], false)]])

		const result = computeAutoCompliance(assessments, [], screeningEffects)
		expect(result.get("ctrl-1:null")?.autoStatus).toBeNull()
		expect(result.get("ctrl-1:null")?.reason).toContain("ikke ferdig besvart")
	})

	it("returns 'implemented' when routine matches and is not overdue", () => {
		const assessments = [makeAssessment("ctrl-1", null)]
		const deadlines = [makeDeadline("routine-1", ["ctrl-1"], "persistence", false, new Date())]
		const screeningEffects = new Map()

		const result = computeAutoCompliance(assessments, deadlines, screeningEffects)
		expect(result.get("ctrl-1:null")?.autoStatus).toBe("implemented")
		expect(result.get("ctrl-1:null")?.sources).toContain("persistence")
	})

	it("returns 'partially_implemented' when routine matches but is overdue", () => {
		const assessments = [makeAssessment("ctrl-1", null)]
		const deadlines = [makeDeadline("routine-1", ["ctrl-1"], "screening", true, new Date("2024-01-01"))]
		const screeningEffects = new Map()

		const result = computeAutoCompliance(assessments, deadlines, screeningEffects)
		expect(result.get("ctrl-1:null")?.autoStatus).toBe("partially_implemented")
		expect(result.get("ctrl-1:null")?.hasOverdueRoutine).toBe(true)
	})

	it("returns 'partially_implemented' when routine matches but never reviewed and not overdue", () => {
		const assessments = [makeAssessment("ctrl-1", null)]
		const deadlines = [makeDeadline("routine-1", ["ctrl-1"], "section", false, null)]
		const screeningEffects = new Map()

		const result = computeAutoCompliance(assessments, deadlines, screeningEffects)
		expect(result.get("ctrl-1:null")?.autoStatus).toBe("partially_implemented")
		expect(result.get("ctrl-1:null")?.reason).toContain("ikke gjennomgått ennå")
	})

	it("returns 'not_implemented' when routine matches but never reviewed and overdue", () => {
		const assessments = [makeAssessment("ctrl-1", null)]
		const deadlines = [makeDeadline("routine-1", ["ctrl-1"], "section", true, null)]
		const screeningEffects = new Map()

		const result = computeAutoCompliance(assessments, deadlines, screeningEffects)
		expect(result.get("ctrl-1:null")?.autoStatus).toBe("not_implemented")
		expect(result.get("ctrl-1:null")?.reason).toContain("aldri gjennomgått og forfalt")
	})

	it("returns 'not_implemented' when screening says not_implemented even with routine match", () => {
		const assessments = [makeAssessment("ctrl-1", null)]
		const deadlines = [makeDeadline("routine-1", ["ctrl-1"], "persistence", false, new Date())]
		const screeningEffects = new Map([["ctrl-1:all", makeScreening(["not_implemented"], true)]])

		const result = computeAutoCompliance(assessments, deadlines, screeningEffects)
		expect(result.get("ctrl-1:null")?.autoStatus).toBe("not_implemented")
	})

	it("routine with no tech elements matches all assessment rows for the control", () => {
		const assessments = [makeAssessment("ctrl-1", "elem-a"), makeAssessment("ctrl-1", "elem-b")]
		const deadlines = [makeDeadline("routine-1", ["ctrl-1"], "persistence", false, new Date())]
		const screeningEffects = new Map()

		const result = computeAutoCompliance(assessments, deadlines, screeningEffects)
		expect(result.get("ctrl-1:elem-a")?.autoStatus).toBe("implemented")
		expect(result.get("ctrl-1:elem-b")?.autoStatus).toBe("implemented")
	})

	it("routine with specific tech elements only matches assessments with those elements", () => {
		const assessments = [makeAssessment("ctrl-1", "elem-db"), makeAssessment("ctrl-1", "elem-app")]
		// Routine is only for "elem-db" (Database)
		const deadlines = [makeDeadline("routine-1", ["ctrl-1"], "persistence", false, new Date(), ["elem-db"])]
		const screeningEffects = new Map()

		const result = computeAutoCompliance(assessments, deadlines, screeningEffects)
		// Should match Database row
		expect(result.get("ctrl-1:elem-db")?.autoStatus).toBe("implemented")
		expect(result.get("ctrl-1:elem-db")?.establishment).toBe("established")
		// Should NOT match Applikasjon row
		expect(result.get("ctrl-1:elem-app")?.autoStatus).toBeNull()
		expect(result.get("ctrl-1:elem-app")?.establishment).toBe("not_established")
	})

	it("routine with tech elements still matches assessment rows with no tech element", () => {
		const assessments = [makeAssessment("ctrl-1", null), makeAssessment("ctrl-1", "elem-db")]
		const deadlines = [makeDeadline("routine-1", ["ctrl-1"], "persistence", false, new Date(), ["elem-db"])]
		const screeningEffects = new Map()

		const result = computeAutoCompliance(assessments, deadlines, screeningEffects)
		// No-tech-element assessment gets the routine (fallback)
		expect(result.get("ctrl-1:null")?.autoStatus).toBe("implemented")
		expect(result.get("ctrl-1:elem-db")?.autoStatus).toBe("implemented")
	})

	it("does not override manually set status in the computation", () => {
		const assessments = [makeAssessment("ctrl-1", null, "not_relevant")]
		const deadlines = [makeDeadline("routine-1", ["ctrl-1"], "persistence", false, new Date())]
		const screeningEffects = new Map()

		// computeAutoCompliance still computes autoStatus regardless of manual status
		const result = computeAutoCompliance(assessments, deadlines, screeningEffects)
		expect(result.get("ctrl-1:null")?.autoStatus).toBe("implemented")
		// The merging logic (manual overrides auto) is in the loader, not here
	})

	it("collects unique routine IDs from multiple sources", () => {
		const assessments = [makeAssessment("ctrl-1", null)]
		const deadlines = [
			makeDeadline("routine-1", ["ctrl-1"], "persistence", false, new Date()),
			makeDeadline("routine-2", ["ctrl-1"], "section", false, new Date()),
		]
		const screeningEffects = new Map()

		const result = computeAutoCompliance(assessments, deadlines, screeningEffects)
		const auto = result.get("ctrl-1:null")!
		expect(auto.autoStatus).toBe("implemented")
		expect(auto.matchingRoutineIds).toContain("routine-1")
		expect(auto.matchingRoutineIds).toContain("routine-2")
		expect(auto.sources).toContain("persistence")
		expect(auto.sources).toContain("section")
	})

	it("returns null when screening answers gave no effects", () => {
		const assessments = [makeAssessment("ctrl-1", null)]
		const screeningEffects = new Map([["ctrl-1:all", makeScreening([], true)]])

		const result = computeAutoCompliance(assessments, [], screeningEffects)
		expect(result.get("ctrl-1:null")?.autoStatus).toBeNull()
		expect(result.get("ctrl-1:null")?.reason).toContain("ingen effekter")
	})

	it("returns 'implemented' from screening effects when all say implemented", () => {
		const assessments = [makeAssessment("ctrl-1", null)]
		const screeningEffects = new Map([["ctrl-1:all", makeScreening(["implemented", "implemented"], true)]])

		const result = computeAutoCompliance(assessments, [], screeningEffects)
		expect(result.get("ctrl-1:null")?.autoStatus).toBe("implemented")
	})

	it("returns 'partially_implemented' from mixed screening effects", () => {
		const assessments = [makeAssessment("ctrl-1", null)]
		const screeningEffects = new Map([["ctrl-1:all", makeScreening(["implemented", "not_relevant"], true)]])

		const result = computeAutoCompliance(assessments, [], screeningEffects)
		expect(result.get("ctrl-1:null")?.autoStatus).toBe("partially_implemented")
	})

	it("handles controls with no matching deadlines but returns entry for each assessment", () => {
		const assessments = [makeAssessment("ctrl-1", null), makeAssessment("ctrl-2", "elem-x")]
		const deadlines = [makeDeadline("routine-1", ["ctrl-1"], "persistence", false, new Date())]
		const screeningEffects = new Map()

		const result = computeAutoCompliance(assessments, deadlines, screeningEffects)
		expect(result.size).toBe(2)
		expect(result.get("ctrl-1:null")?.autoStatus).toBe("implemented")
		expect(result.get("ctrl-2:elem-x")?.autoStatus).toBeNull()
	})

	it("recognizes group_classification match source", () => {
		const assessments = [makeAssessment("ctrl-1", null)]
		const deadlines = [makeDeadline("routine-gc", ["ctrl-1"], "group_classification", false, new Date())]
		const screeningEffects = new Map()

		const result = computeAutoCompliance(assessments, deadlines, screeningEffects)
		const auto = result.get("ctrl-1:null")
		expect(auto).toBeDefined()
		expect(auto?.autoStatus).toBe("implemented")
		expect(auto?.sources).toContain("group_classification")
		expect(auto?.matchingRoutineIds).toContain("routine-gc")
	})

	it("returns 'not_relevant' when screening says not_relevant even with routine match", () => {
		const assessments = [makeAssessment("ctrl-1", null)]
		const deadlines = [makeDeadline("routine-1", ["ctrl-1"], "persistence", false, new Date())]
		const screeningEffects = new Map([["ctrl-1:all", makeScreening(["not_relevant"], true)]])

		const result = computeAutoCompliance(assessments, deadlines, screeningEffects)
		const auto = result.get("ctrl-1:null")
		expect(auto?.autoStatus).toBe("not_relevant")
		expect(auto?.establishment).toBe("not_relevant")
		expect(auto?.sources).toEqual([])
		expect(auto?.matchingRoutineIds).toEqual([])
		expect(auto?.routinesEstablished).toBe(0)
		expect(auto?.hasOverdueRoutine).toBe(false)
	})

	it("combines group_classification and screening sources", () => {
		const assessments = [makeAssessment("ctrl-1", null)]
		const deadlines = [
			makeDeadline("routine-gc", ["ctrl-1"], "group_classification", false, new Date()),
			makeDeadline("routine-scr", ["ctrl-1"], "screening", false, new Date()),
		]
		const screeningEffects = new Map()

		const result = computeAutoCompliance(assessments, deadlines, screeningEffects)
		const auto = result.get("ctrl-1:null")
		expect(auto?.autoStatus).toBe("implemented")
		expect(auto?.sources).toContain("group_classification")
		expect(auto?.sources).toContain("screening")
		expect(auto?.routinesEstablished).toBe(2)
	})

	// ─── Technology-element-scoped screening tests ──────────────────

	it("tech-scoped screening only applies to matching assessment rows", () => {
		const assessments = [makeAssessment("ctrl-1", "elem-db"), makeAssessment("ctrl-1", "elem-app")]
		// Screening for "Database" only → not_relevant
		const screeningEffects = new Map([["ctrl-1:elem-db", makeScreening(["not_relevant"], true)]])

		const result = computeAutoCompliance(assessments, [], screeningEffects)
		// Database row should be not_relevant
		expect(result.get("ctrl-1:elem-db")?.autoStatus).toBe("not_relevant")
		// Applikasjon row should have NO screening → null
		expect(result.get("ctrl-1:elem-app")?.autoStatus).toBeNull()
		expect(result.get("ctrl-1:elem-app")?.reason).toContain("Ingen rutiner eller screeningspørsmål")
	})

	it("global screening (key=all) applies to all tech element assessment rows", () => {
		const assessments = [makeAssessment("ctrl-1", "elem-db"), makeAssessment("ctrl-1", "elem-app")]
		const screeningEffects = new Map([["ctrl-1:all", makeScreening(["not_relevant"], true)]])

		const result = computeAutoCompliance(assessments, [], screeningEffects)
		expect(result.get("ctrl-1:elem-db")?.autoStatus).toBe("not_relevant")
		expect(result.get("ctrl-1:elem-app")?.autoStatus).toBe("not_relevant")
	})

	it("merges global + tech-specific screening for matching tech element", () => {
		const assessments = [makeAssessment("ctrl-1", "elem-db"), makeAssessment("ctrl-1", "elem-app")]
		const screeningEffects = new Map([
			["ctrl-1:all", makeScreening(["implemented"], true)],
			["ctrl-1:elem-db", makeScreening(["not_relevant"], true)],
		])

		const result = computeAutoCompliance(assessments, [], screeningEffects)
		// Database: merged "implemented" + "not_relevant" → partially_implemented (mixed)
		expect(result.get("ctrl-1:elem-db")?.autoStatus).toBe("partially_implemented")
		// Applikasjon: only global "implemented"
		expect(result.get("ctrl-1:elem-app")?.autoStatus).toBe("implemented")
	})

	it("null tech element assessment gets all screening effects (backward-compatible)", () => {
		const assessments = [makeAssessment("ctrl-1", null)]
		const screeningEffects = new Map([
			["ctrl-1:all", makeScreening(["not_relevant"], true)],
			["ctrl-1:elem-db", makeScreening(["not_relevant"], true)],
		])

		const result = computeAutoCompliance(assessments, [], screeningEffects)
		// Null tech element → merged all effects
		expect(result.get("ctrl-1:null")?.autoStatus).toBe("not_relevant")
	})

	it("handles global answered + tech-specific unanswered correctly", () => {
		const assessments = [makeAssessment("ctrl-1", "elem-db")]
		const screeningEffects = new Map([
			["ctrl-1:all", makeScreening(["implemented"], true)],
			["ctrl-1:elem-db", makeScreening([], false)],
		])

		const result = computeAutoCompliance(assessments, [], screeningEffects)
		// allQuestionsAnswered is false because tech-specific has unanswered questions
		expect(result.get("ctrl-1:elem-db")?.autoStatus).toBeNull()
		expect(result.get("ctrl-1:elem-db")?.reason).toContain("ikke ferdig besvart")
	})

	it("tech-specific screening only, no global", () => {
		const assessments = [makeAssessment("ctrl-1", "elem-db"), makeAssessment("ctrl-1", "elem-app")]
		const screeningEffects = new Map([["ctrl-1:elem-db", makeScreening(["implemented"], true)]])

		const result = computeAutoCompliance(assessments, [], screeningEffects)
		expect(result.get("ctrl-1:elem-db")?.autoStatus).toBe("implemented")
		// elem-app gets no screening at all
		expect(result.get("ctrl-1:elem-app")?.autoStatus).toBeNull()
	})
})

describe("mergeScreeningEffects", () => {
	it("returns undefined when both inputs are undefined", () => {
		expect(mergeScreeningEffects(undefined, undefined)).toBeUndefined()
	})

	it("returns a when b is undefined", () => {
		const a = makeScreening(["not_relevant"], true)
		expect(mergeScreeningEffects(a, undefined)).toBe(a)
	})

	it("returns b when a is undefined", () => {
		const b = makeScreening(["implemented"], true)
		expect(mergeScreeningEffects(undefined, b)).toBe(b)
	})

	it("merges effects and details from both", () => {
		const a = makeScreening(["not_relevant"], true)
		const b = makeScreening(["implemented"], true)
		const merged = mergeScreeningEffects(a, b)
		expect(merged).toBeDefined()

		expect(merged?.effects).toEqual(["not_relevant", "implemented"])
		expect(merged?.details).toHaveLength(2)
		expect(merged?.allQuestionsAnswered).toBe(true)
		expect(merged?.hasQuestions).toBe(true)
	})

	it("ANDs allQuestionsAnswered correctly", () => {
		const answered = makeScreening(["implemented"], true)
		const unanswered = makeScreening([], false)
		const merged = mergeScreeningEffects(answered, unanswered)
		expect(merged).toBeDefined()

		expect(merged?.allQuestionsAnswered).toBe(false)
	})
})
