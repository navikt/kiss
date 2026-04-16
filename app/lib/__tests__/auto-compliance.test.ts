import { describe, expect, it } from "vitest"
import { computeAutoCompliance } from "../auto-compliance"

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
	matchSource: "screening" | "persistence" | "screening_selection" | "section",
	overdue = false,
	lastReviewDate: Date | null = new Date(),
) => ({
	routine: { id: routineId, controls: controlIds.map((id) => ({ id })) },
	matchSource,
	overdue,
	lastReviewDate,
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
		const screeningEffects = new Map([
			[
				"ctrl-1",
				{
					effects: ["not_relevant"],
					allQuestionsAnswered: true,
					hasQuestions: true,
				},
			],
		])

		const result = computeAutoCompliance(assessments, [], screeningEffects)
		expect(result.get("ctrl-1:null")?.autoStatus).toBe("not_relevant")
	})

	it("returns null when screening questions are not yet answered", () => {
		const assessments = [makeAssessment("ctrl-1", null)]
		const screeningEffects = new Map([
			[
				"ctrl-1",
				{
					effects: [],
					allQuestionsAnswered: false,
					hasQuestions: true,
				},
			],
		])

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
		const screeningEffects = new Map([
			[
				"ctrl-1",
				{
					effects: ["not_implemented"],
					allQuestionsAnswered: true,
					hasQuestions: true,
				},
			],
		])

		const result = computeAutoCompliance(assessments, deadlines, screeningEffects)
		expect(result.get("ctrl-1:null")?.autoStatus).toBe("not_implemented")
	})

	it("handles multiple assessments with different tech elements", () => {
		const assessments = [makeAssessment("ctrl-1", "elem-a"), makeAssessment("ctrl-1", "elem-b")]
		const deadlines = [makeDeadline("routine-1", ["ctrl-1"], "persistence", false, new Date())]
		const screeningEffects = new Map()

		const result = computeAutoCompliance(assessments, deadlines, screeningEffects)
		expect(result.get("ctrl-1:elem-a")?.autoStatus).toBe("implemented")
		expect(result.get("ctrl-1:elem-b")?.autoStatus).toBe("implemented")
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
		const screeningEffects = new Map([
			[
				"ctrl-1",
				{
					effects: [],
					allQuestionsAnswered: true,
					hasQuestions: true,
				},
			],
		])

		const result = computeAutoCompliance(assessments, [], screeningEffects)
		expect(result.get("ctrl-1:null")?.autoStatus).toBeNull()
		expect(result.get("ctrl-1:null")?.reason).toContain("ingen effekter")
	})

	it("returns 'implemented' from screening effects when all say implemented", () => {
		const assessments = [makeAssessment("ctrl-1", null)]
		const screeningEffects = new Map([
			[
				"ctrl-1",
				{
					effects: ["implemented", "implemented"],
					allQuestionsAnswered: true,
					hasQuestions: true,
				},
			],
		])

		const result = computeAutoCompliance(assessments, [], screeningEffects)
		expect(result.get("ctrl-1:null")?.autoStatus).toBe("implemented")
	})

	it("returns 'partially_implemented' from mixed screening effects", () => {
		const assessments = [makeAssessment("ctrl-1", null)]
		const screeningEffects = new Map([
			[
				"ctrl-1",
				{
					effects: ["implemented", "not_relevant"],
					allQuestionsAnswered: true,
					hasQuestions: true,
				},
			],
		])

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
})
