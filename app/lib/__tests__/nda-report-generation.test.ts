import { describe, expect, it } from "vitest"
import {
	getNdaReportGenerationDeadline,
	isNdaReportGenerationInProgress,
	isNdaReportGenerationStale,
	isNdaReportReadyForApp,
	NDA_REPORT_GENERATION_STALE_MS,
} from "../nda-report-generation"

const now = Date.parse("2026-04-01T12:00:00Z")
const recent = new Date(now - 60_000).toISOString()
const old = new Date(now - NDA_REPORT_GENERATION_STALE_MS - 1).toISOString()

describe("nda-report-generation", () => {
	it("treats recent starting and pending states as in progress", () => {
		expect(isNdaReportGenerationInProgress({ status: "starting", updatedAt: recent }, now)).toBe(true)
		expect(isNdaReportGenerationInProgress({ status: "pending", updatedAt: recent }, now)).toBe(true)
		expect(isNdaReportGenerationStale({ status: "pending", updatedAt: recent }, now)).toBe(false)
	})

	it("treats old or untimed starting and pending states as stale", () => {
		expect(isNdaReportGenerationInProgress({ status: "pending", updatedAt: old }, now)).toBe(false)
		expect(isNdaReportGenerationStale({ status: "pending", updatedAt: old }, now)).toBe(true)
		expect(isNdaReportGenerationStale({ status: "starting" }, now)).toBe(true)
	})

	it("never treats ready or failed states as in progress or stale", () => {
		for (const status of ["ready", "failed"] as const) {
			expect(isNdaReportGenerationInProgress({ status, updatedAt: recent }, now)).toBe(false)
			expect(isNdaReportGenerationStale({ status, updatedAt: old }, now)).toBe(false)
		}
	})

	it("computes the deadline from updatedAt", () => {
		expect(getNdaReportGenerationDeadline({ updatedAt: recent })).toBe(now - 60_000 + NDA_REPORT_GENERATION_STALE_MS)
		expect(getNdaReportGenerationDeadline({})).toBe(0)
	})
})

describe("isNdaReportReadyForApp", () => {
	const app = { team: "team-a", environment: "prod-gcp", appName: "app-a" }
	const period = { periodType: "quarterly", periodStart: "2026-01-01" }
	const readyState = (overrides: Record<string, unknown> = {}) =>
		({
			applicationId: "app-1",
			...app,
			attemptId: "a",
			jobId: null,
			status: "ready",
			error: null,
			report: { ...period, availableFormats: ["pdf", "excel"] },
			...overrides,
		}) as unknown as Parameters<typeof isNdaReportReadyForApp>[0]

	it("accepts a matching ready report with both formats", () => {
		expect(isNdaReportReadyForApp(readyState(), app, period)).toBe(true)
	})

	it("rejects a report generated for a renamed or moved application", () => {
		expect(isNdaReportReadyForApp(readyState({ appName: "gammelt-navn" }), app, period)).toBe(false)
		expect(isNdaReportReadyForApp(readyState({ environment: "dev-gcp" }), app, period)).toBe(false)
	})

	it("rejects other periods and missing formats", () => {
		expect(isNdaReportReadyForApp(readyState(), app, { ...period, periodStart: "2026-04-01" })).toBe(false)
		expect(isNdaReportReadyForApp(readyState({ report: { ...period, availableFormats: ["pdf"] } }), app, period)).toBe(
			false,
		)
	})
})
