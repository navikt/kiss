import { describe, expect, it } from "vitest"
import { computeRoutineComplianceCounts } from "../routine-compliance"

function makeDeadline(overrides: {
	frequency: string | null
	overdue: boolean
	lastReviewDate: string | null
	needsFollowUp?: boolean
}) {
	return {
		// Modellerer produksjonsdata: routine-objektet finnes alltid, men frequency kan være null for hendelsesbaserte rutiner
		routine: { frequency: overrides.frequency },
		overdue: overrides.overdue,
		lastReviewDate: overrides.lastReviewDate,
		needsFollowUp: overrides.needsFollowUp,
	}
}

describe("computeRoutineComplianceCounts", () => {
	it("ekskluderer hendelsesbaserte rutiner (frequency=null) fra gjennomfort/ikkeGjennomfort og prosent", () => {
		const deadlines = [
			makeDeadline({ frequency: null, overdue: false, lastReviewDate: "2026-03-01", needsFollowUp: false }),
			makeDeadline({ frequency: null, overdue: true, lastReviewDate: null }),
		]
		const result = computeRoutineComplianceCounts(deadlines)
		expect(result.routinesGjennomfort).toBe(0)
		expect(result.routinesIkkeGjennomfort).toBe(0)
		expect(result.routinesMaaFolgesOpp).toBe(0)
		expect(result.routineCompliancePercent).toBe(0)
	})

	it("teller needsFollowUp på hendelsesbasert rutine i routinesMaaFolgesOpp", () => {
		const deadlines = [
			makeDeadline({ frequency: null, overdue: false, lastReviewDate: "2026-03-01", needsFollowUp: true }),
		]
		const result = computeRoutineComplianceCounts(deadlines)
		expect(result.routinesMaaFolgesOpp).toBe(1)
		// Skal ikke påvirke prosent
		expect(result.routinesGjennomfort).toBe(0)
		expect(result.routinesIkkeGjennomfort).toBe(0)
		expect(result.routineCompliancePercent).toBe(0)
	})

	it("plasserer overdue-rutiner i ikkeGjennomfort", () => {
		const deadlines = [makeDeadline({ frequency: "monthly", overdue: true, lastReviewDate: "2026-01-01" })]
		const result = computeRoutineComplianceCounts(deadlines)
		expect(result.routinesIkkeGjennomfort).toBe(1)
		expect(result.routinesGjennomfort).toBe(0)
	})

	it("plasserer aldri-gjennomgåtte rutiner (lastReviewDate=null) i ikkeGjennomfort", () => {
		const deadlines = [makeDeadline({ frequency: "quarterly", overdue: false, lastReviewDate: null })]
		const result = computeRoutineComplianceCounts(deadlines)
		expect(result.routinesIkkeGjennomfort).toBe(1)
		expect(result.routinesGjennomfort).toBe(0)
	})

	it("teller needsFollowUp på periodisk rutine separat uten å påvirke gjennomfort/ikkeGjennomfort", () => {
		const deadlines = [
			makeDeadline({ frequency: "quarterly", overdue: false, lastReviewDate: "2026-03-01", needsFollowUp: true }),
			makeDeadline({ frequency: "semi_annually", overdue: false, lastReviewDate: "2026-03-15", needsFollowUp: false }),
		]
		const result = computeRoutineComplianceCounts(deadlines)
		expect(result.routinesGjennomfort).toBe(2)
		expect(result.routinesIkkeGjennomfort).toBe(0)
		expect(result.routinesMaaFolgesOpp).toBe(1)
		expect(result.routineCompliancePercent).toBe(100)
	})

	it("beregner prosent korrekt med blanding av gjennomfort, ikkeGjennomfort og hendelsesbaserte", () => {
		const deadlines = [
			makeDeadline({ frequency: "quarterly", overdue: false, lastReviewDate: "2026-03-01", needsFollowUp: true }),
			makeDeadline({ frequency: "semi_annually", overdue: false, lastReviewDate: "2026-03-15" }),
			makeDeadline({ frequency: "monthly", overdue: true, lastReviewDate: null }),
			makeDeadline({ frequency: "semi_annually", overdue: false, lastReviewDate: "2026-02-01" }),
			makeDeadline({ frequency: null, overdue: false, lastReviewDate: "2026-02-10" }),
			makeDeadline({ frequency: null, overdue: false, lastReviewDate: null }),
		]
		const result = computeRoutineComplianceCounts(deadlines)
		expect(result.routinesGjennomfort).toBe(3)
		expect(result.routinesIkkeGjennomfort).toBe(1)
		expect(result.routinesMaaFolgesOpp).toBe(1)
		// 3/(3+1) = 75%
		expect(result.routineCompliancePercent).toBe(75)
	})

	it("returnerer 0% når det ikke finnes periodiske rutiner", () => {
		const result = computeRoutineComplianceCounts([])
		expect(result.routineCompliancePercent).toBe(0)
	})
})
