import { describe, expect, it } from "vitest"
import {
	isManualActivity,
	isManualActivityComplete,
	parseManualActivityStagedData,
} from "~/lib/manual-activity-staged-data"

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STEP_ID_1 = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"
const STEP_ID_2 = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb"

function makeRaw(overrides: object = {}) {
	return {
		activityType: "manual_activity",
		schemaVersion: 1,
		steps: [],
		...overrides,
	}
}

function makeStep(overrides: object = {}) {
	return {
		stepId: STEP_ID_1,
		title: "Kontroller tilgang",
		description: "Beskriv fremgangsmåte",
		completedAt: null,
		completedBy: null,
		notes: null,
		...overrides,
	}
}

// ─── parseManualActivityStagedData ────────────────────────────────────────────

describe("parseManualActivityStagedData", () => {
	it("parses minimal valid data (no steps)", () => {
		const result = parseManualActivityStagedData(makeRaw())
		expect(result.activityType).toBe("manual_activity")
		expect(result.schemaVersion).toBe(1)
		expect(result.steps).toEqual([])
	})

	it("parses a step with required fields", () => {
		const result = parseManualActivityStagedData(makeRaw({ steps: [makeStep()] }))
		expect(result.steps).toHaveLength(1)
		expect(result.steps[0].stepId).toBe(STEP_ID_1)
		expect(result.steps[0].title).toBe("Kontroller tilgang")
		expect(result.steps[0].description).toBe("Beskriv fremgangsmåte")
		expect(result.steps[0].completedAt).toBeNull()
		expect(result.steps[0].notes).toBeNull()
	})

	it("coerces missing notes to null", () => {
		const step = makeStep()
		// @ts-expect-error testing runtime coercion
		delete step.notes
		const result = parseManualActivityStagedData(makeRaw({ steps: [step] }))
		expect(result.steps[0].notes).toBeNull()
	})

	it("parses a completed step", () => {
		const step = makeStep({
			completedAt: "2026-06-01T10:00:00Z",
			completedBy: "Z990001",
			notes: "Alt er OK",
		})
		const result = parseManualActivityStagedData(makeRaw({ steps: [step] }))
		expect(result.steps[0].completedAt).toBe("2026-06-01T10:00:00Z")
		expect(result.steps[0].completedBy).toBe("Z990001")
		expect(result.steps[0].notes).toBe("Alt er OK")
	})

	it("parses componentConfig with items", () => {
		const step = makeStep({
			componentConfig: {
				items: [
					{ type: "notater", required: true },
					{ type: "lenker", required: false },
				],
			},
		})
		const result = parseManualActivityStagedData(makeRaw({ steps: [step] }))
		expect(result.steps[0].componentConfig?.items).toHaveLength(2)
		expect(result.steps[0].componentConfig?.items[0]).toEqual({ type: "notater", required: true })
		expect(result.steps[0].componentConfig?.items[1]).toEqual({ type: "lenker", required: false })
	})

	it("promotes legacy `components` field to componentConfig", () => {
		const step = {
			...makeStep(),
			components: [{ type: "vedlegg", required: true }],
		}
		const result = parseManualActivityStagedData(makeRaw({ steps: [step] }))
		expect(result.steps[0].componentConfig).toEqual({ items: [{ type: "vedlegg", required: true }] })
	})

	it("componentConfig wins over legacy components when both present", () => {
		const step = {
			...makeStep(),
			components: [{ type: "vedlegg", required: true }],
			componentConfig: { items: [{ type: "notater", required: false }] },
		}
		const result = parseManualActivityStagedData(makeRaw({ steps: [step] }))
		expect(result.steps[0].componentConfig).toEqual({ items: [{ type: "notater", required: false }] })
	})

	it("leaves componentConfig undefined when neither field is present (backward compat show-all)", () => {
		const result = parseManualActivityStagedData(makeRaw({ steps: [makeStep()] }))
		expect(result.steps[0].componentConfig).toBeUndefined()
	})

	it("throws for wrong activityType", () => {
		expect(() => parseManualActivityStagedData(makeRaw({ activityType: "oracle_evidence_audit" }))).toThrow()
	})

	it("throws for wrong schemaVersion", () => {
		expect(() => parseManualActivityStagedData(makeRaw({ schemaVersion: 2 }))).toThrow()
	})

	it("throws if stepId is not a valid UUID", () => {
		expect(() => parseManualActivityStagedData(makeRaw({ steps: [makeStep({ stepId: "not-a-uuid" })] }))).toThrow()
	})

	it("parses multiple steps", () => {
		const result = parseManualActivityStagedData(
			makeRaw({
				steps: [makeStep({ stepId: STEP_ID_1, title: "Steg 1" }), makeStep({ stepId: STEP_ID_2, title: "Steg 2" })],
			}),
		)
		expect(result.steps).toHaveLength(2)
		expect(result.steps[1].title).toBe("Steg 2")
	})
})

// ─── isManualActivity ─────────────────────────────────────────────────────────

describe("isManualActivity", () => {
	it("returns true for valid manual activity data", () => {
		expect(isManualActivity(makeRaw())).toBe(true)
	})

	it("returns true with steps", () => {
		expect(isManualActivity(makeRaw({ steps: [makeStep()] }))).toBe(true)
	})

	it("returns false for null", () => {
		expect(isManualActivity(null)).toBe(false)
	})

	it("returns false for wrong activityType", () => {
		expect(isManualActivity(makeRaw({ activityType: "oracle_evidence_audit" }))).toBe(false)
	})

	it("returns false for missing schemaVersion", () => {
		const raw = makeRaw()
		// @ts-expect-error testing runtime coercion
		delete raw.schemaVersion
		expect(isManualActivity(raw)).toBe(false)
	})

	it("returns false for non-object", () => {
		expect(isManualActivity("string")).toBe(false)
		expect(isManualActivity(42)).toBe(false)
	})
})

// ─── isManualActivityComplete ─────────────────────────────────────────────────

describe("isManualActivityComplete", () => {
	it("returns false when there are no steps", () => {
		const data = parseManualActivityStagedData(makeRaw())
		expect(isManualActivityComplete(data)).toBe(false)
	})

	it("returns true when all steps are completed", () => {
		const data = parseManualActivityStagedData(
			makeRaw({
				steps: [
					makeStep({ stepId: STEP_ID_1, completedAt: "2026-06-01T10:00:00Z" }),
					makeStep({ stepId: STEP_ID_2, completedAt: "2026-06-01T11:00:00Z" }),
				],
			}),
		)
		expect(isManualActivityComplete(data)).toBe(true)
	})

	it("returns false when at least one step is not completed", () => {
		const data = parseManualActivityStagedData(
			makeRaw({
				steps: [
					makeStep({ stepId: STEP_ID_1, completedAt: "2026-06-01T10:00:00Z" }),
					makeStep({ stepId: STEP_ID_2, completedAt: null }),
				],
			}),
		)
		expect(isManualActivityComplete(data)).toBe(false)
	})

	it("returns false when all steps have completedAt null", () => {
		const data = parseManualActivityStagedData(
			makeRaw({ steps: [makeStep({ stepId: STEP_ID_1 }), makeStep({ stepId: STEP_ID_2 })] }),
		)
		expect(isManualActivityComplete(data)).toBe(false)
	})
})
