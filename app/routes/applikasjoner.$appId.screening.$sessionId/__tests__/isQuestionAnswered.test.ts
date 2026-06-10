import { describe, expect, it } from "vitest"
import { isQuestionAnswered } from "../shared"

type Question = Parameters<typeof isQuestionAnswered>[0]
type Classification = Parameters<typeof isQuestionAnswered>[1]

function makeQuestion(overrides: Partial<Question> = {}): Question {
	return {
		id: "q-1",
		questionText: "Test?",
		description: null,
		answerType: "boolean",
		answer: null,
		comment: null,
		link: null,
		displayOrder: 0,
		status: "approved",
		rulesetId: null,
		...overrides,
	} as Question
}

function makeClassification(overrides: Partial<NonNullable<Classification>> = {}): NonNullable<Classification> {
	return {
		id: "ec-1",
		isEconomySystem: true,
		economySystemType: "hjelpesystem",
		justification: "test",
		validFrom: "2026-01-01T00:00:00Z",
		validUntil: "2027-01-01T00:00:00Z",
		isExpired: false,
		...overrides,
	}
}

describe("isQuestionAnswered", () => {
	describe("boolean questions", () => {
		it("returns true when answer is not null", () => {
			const q = makeQuestion({ answerType: "boolean", answer: "Ja" })
			expect(isQuestionAnswered(q)).toBe(true)
		})

		it("returns false when answer is null", () => {
			const q = makeQuestion({ answerType: "boolean", answer: null })
			expect(isQuestionAnswered(q)).toBe(false)
		})
	})

	describe("persistence questions", () => {
		it("returns true when confirmed", () => {
			const q = makeQuestion({ answerType: "persistence", answer: "confirmed" })
			expect(isQuestionAnswered(q)).toBe(true)
		})

		it("returns false when not confirmed", () => {
			const q = makeQuestion({ answerType: "persistence", answer: null })
			expect(isQuestionAnswered(q)).toBe(false)
		})

		it("returns false when answer is something other than confirmed", () => {
			const q = makeQuestion({ answerType: "persistence", answer: "partial" })
			expect(isQuestionAnswered(q)).toBe(false)
		})
	})

	describe("economy_system questions", () => {
		it("returns true when confirmed with valid classification", () => {
			const q = makeQuestion({ answerType: "economy_system", answer: "confirmed" })
			const ec = makeClassification({ isExpired: false })
			expect(isQuestionAnswered(q, ec)).toBe(true)
		})

		it("returns false when confirmed but classification is expired", () => {
			const q = makeQuestion({ answerType: "economy_system", answer: "confirmed" })
			const ec = makeClassification({ isExpired: true })
			expect(isQuestionAnswered(q, ec)).toBe(false)
		})

		it("returns false when confirmed but no classification exists (null)", () => {
			const q = makeQuestion({ answerType: "economy_system", answer: "confirmed" })
			expect(isQuestionAnswered(q, null)).toBe(false)
		})

		it("returns false when confirmed but classification is undefined", () => {
			const q = makeQuestion({ answerType: "economy_system", answer: "confirmed" })
			expect(isQuestionAnswered(q, undefined)).toBe(false)
		})

		it("returns false when answer is not confirmed", () => {
			const q = makeQuestion({ answerType: "economy_system", answer: null })
			const ec = makeClassification({ isExpired: false })
			expect(isQuestionAnswered(q, ec)).toBe(false)
		})

		it("returns true for non-economy classification even when valid", () => {
			const q = makeQuestion({ answerType: "economy_system", answer: "confirmed" })
			const ec = makeClassification({ isEconomySystem: false, isExpired: false })
			expect(isQuestionAnswered(q, ec)).toBe(true)
		})
	})

	describe("entra_id_groups questions", () => {
		it("returns true when confirmed", () => {
			const q = makeQuestion({ answerType: "entra_id_groups", answer: "confirmed" })
			expect(isQuestionAnswered(q)).toBe(true)
		})

		it("returns false when not confirmed", () => {
			const q = makeQuestion({ answerType: "entra_id_groups", answer: null })
			expect(isQuestionAnswered(q)).toBe(false)
		})
	})
})
