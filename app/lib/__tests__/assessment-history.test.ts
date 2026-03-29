import { describe, expect, it } from "vitest"
import type { AssessmentChange } from "../assessment-history"
import { describeChange } from "../assessment-history"

function makeChange(overrides: Partial<AssessmentChange> = {}): AssessmentChange {
	return {
		id: "change-1",
		controlId: "K-ST.01",
		previousStatus: "not_implemented",
		newStatus: "implemented",
		previousComment: null,
		newComment: null,
		changedBy: "testuser",
		changedAt: "2024-01-15T12:00:00Z",
		...overrides,
	}
}

describe("describeChange", () => {
	it("describes a status change from one value to another", () => {
		const result = describeChange(
			makeChange({
				previousStatus: "not_implemented",
				newStatus: "implemented",
			}),
		)
		expect(result).toBe('Status endret fra "not_implemented" til "implemented"')
	})

	it("describes an initial status when previousStatus is null", () => {
		const result = describeChange(
			makeChange({
				previousStatus: null,
				newStatus: "partially_implemented",
			}),
		)
		expect(result).toBe('Status satt til "partially_implemented"')
	})

	it("describes a comment being added", () => {
		const result = describeChange(
			makeChange({
				previousStatus: "implemented",
				newStatus: "implemented",
				previousComment: null,
				newComment: "New comment",
			}),
		)
		expect(result).toBe("Kommentar lagt til")
	})

	it("describes a comment being removed", () => {
		const result = describeChange(
			makeChange({
				previousStatus: "implemented",
				newStatus: "implemented",
				previousComment: "Old comment",
				newComment: null,
			}),
		)
		expect(result).toBe("Kommentar fjernet")
	})

	it("describes a comment being updated", () => {
		const result = describeChange(
			makeChange({
				previousStatus: "implemented",
				newStatus: "implemented",
				previousComment: "Old comment",
				newComment: "Updated comment",
			}),
		)
		expect(result).toBe("Kommentar oppdatert")
	})

	it("describes both status and comment changes together", () => {
		const result = describeChange(
			makeChange({
				previousStatus: "not_implemented",
				newStatus: "implemented",
				previousComment: null,
				newComment: "Done",
			}),
		)
		expect(result).toBe('Status endret fra "not_implemented" til "implemented". Kommentar lagt til')
	})

	it("returns 'Ingen endringer' when nothing changed", () => {
		const result = describeChange(
			makeChange({
				previousStatus: "implemented",
				newStatus: "implemented",
				previousComment: "Same",
				newComment: "Same",
			}),
		)
		expect(result).toBe("Ingen endringer")
	})

	it("returns 'Ingen endringer' when both are null and status is same", () => {
		const result = describeChange(
			makeChange({
				previousStatus: "not_relevant",
				newStatus: "not_relevant",
				previousComment: null,
				newComment: null,
			}),
		)
		expect(result).toBe("Ingen endringer")
	})
})
