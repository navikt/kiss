import { afterEach, describe, expect, it, vi } from "vitest"
import { enrichAppAssessments } from "../app-assessment-enrichment.server"

vi.mock("../routine-deadlines.server", () => ({
	getRoutineDeadlinesWithControls: vi.fn(),
}))
vi.mock("../compliance-auto.server", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../compliance-auto.server")>()
	return {
		...actual,
		getScreeningEffectsByControlForApp: vi.fn(),
	}
})
vi.mock("../application-controls.server", () => ({
	getActiveApplicationControls: vi.fn(),
}))

const { getRoutineDeadlinesWithControls } = await import("../routine-deadlines.server")
const { getScreeningEffectsByControlForApp } = await import("../compliance-auto.server")
const { getActiveApplicationControls } = await import("../application-controls.server")

const mockDeadlines = vi.mocked(getRoutineDeadlinesWithControls)
const mockScreening = vi.mocked(getScreeningEffectsByControlForApp)
const mockControls = vi.mocked(getActiveApplicationControls)

afterEach(() => {
	vi.resetAllMocks()
})

describe("enrichAppAssessments", () => {
	it("overlays persisted comment metadata onto raw assessments", async () => {
		mockDeadlines.mockResolvedValue([])
		mockScreening.mockResolvedValue(new Map())
		const updatedAt = new Date("2026-01-15T10:00:00Z")
		mockControls.mockResolvedValue([
			{
				id: "ac1",
				controlId: "ctrl-1",
				technologyElementId: null,
				comment: "Vurdert OK",
				commentUpdatedBy: "X123456",
				commentUpdatedAt: updatedAt,
			} as Awaited<ReturnType<typeof getActiveApplicationControls>>[number],
		])

		const result = await enrichAppAssessments("app-1", [
			{ controlUuid: "ctrl-1", technologyElementId: null, controlId: "K-ST.01" },
			{ controlUuid: "ctrl-2", technologyElementId: null, controlId: "K-ST.02" },
		])

		expect(result[0]).toMatchObject({
			controlId: "K-ST.01",
			comment: "Vurdert OK",
			commentUpdatedBy: "X123456",
			commentUpdatedAt: updatedAt.toISOString(),
			effectiveStatus: null,
		})
		expect(result[1]).toMatchObject({
			controlId: "K-ST.02",
			comment: null,
			commentUpdatedBy: null,
			commentUpdatedAt: null,
		})
	})

	it("uses composite key including technologyElementId for comment lookup", async () => {
		mockDeadlines.mockResolvedValue([])
		mockScreening.mockResolvedValue(new Map())
		mockControls.mockResolvedValue([
			{
				id: "ac1",
				controlId: "ctrl-1",
				technologyElementId: "tech-a",
				comment: "For tech-a",
				commentUpdatedBy: "U1",
				commentUpdatedAt: new Date("2026-01-01"),
			} as Awaited<ReturnType<typeof getActiveApplicationControls>>[number],
		])

		const result = await enrichAppAssessments("app-1", [
			{ controlUuid: "ctrl-1", technologyElementId: "tech-a" },
			{ controlUuid: "ctrl-1", technologyElementId: "tech-b" },
		])

		expect(result[0].comment).toBe("For tech-a")
		expect(result[1].comment).toBeNull()
	})

	it("returns null effectiveStatus and null comment fields when supporting tables fail", async () => {
		mockDeadlines.mockRejectedValue(new Error("relation does not exist"))
		mockScreening.mockRejectedValue(new Error("relation does not exist"))
		mockControls.mockRejectedValue(new Error("relation does not exist"))

		const result = await enrichAppAssessments("app-1", [
			{ controlUuid: "ctrl-1", technologyElementId: null, controlId: "K-ST.01" },
		])

		expect(result).toHaveLength(1)
		expect(result[0]).toMatchObject({
			controlId: "K-ST.01",
			effectiveStatus: null,
			comment: null,
			commentUpdatedBy: null,
			commentUpdatedAt: null,
		})
	})
})
