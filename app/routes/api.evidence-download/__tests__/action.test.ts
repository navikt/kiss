import { beforeEach, describe, expect, it, vi } from "vitest"

const ACTIVITY_ID = "11111111-1111-4111-8111-111111111111"

const mockRequireAuthenticatedUser = vi.fn()
vi.mock("~/lib/auth.server", () => ({
	requireAuthenticatedUser: mockRequireAuthenticatedUser,
}))

const mockRequireAnySectionRole = vi.fn()
vi.mock("~/lib/authorization.server", () => ({
	requireAnySectionRole: mockRequireAnySectionRole,
}))

const mockGetActivityContext = vi.fn()
vi.mock("~/db/queries/evidence-downloads.server", () => ({
	getActivityContext: mockGetActivityContext,
	recordEvidenceDownload: vi.fn(),
	recordManualEvidenceUpload: vi.fn(),
}))

const mockBeginNdaReportGeneration = vi.fn()
const mockSaveNdaReportGenerationState = vi.fn()
vi.mock("~/db/queries/routines.server", () => ({
	beginNdaReportGeneration: mockBeginNdaReportGeneration,
	saveNdaReportGenerationState: mockSaveNdaReportGenerationState,
}))

const mockGetNdaAppParamsGroup = vi.fn()
vi.mock("~/db/queries/deployment-audit.server", () => ({
	getNdaAppParamsGroup: mockGetNdaAppParamsGroup,
}))

const mockGetAppScopeIdsForApps = vi.fn()
vi.mock("~/db/queries/applications.server", () => ({
	getAppScopeIdsForApps: mockGetAppScopeIdsForApps,
}))

const mockProvider = {
	requestGeneration: vi.fn(),
	getJobStatus: vi.fn(),
}
vi.mock("~/lib/evidence-providers/index.server", () => ({
	getEvidenceProvider: vi.fn(async () => mockProvider),
	isEvidenceProviderType: (value: string) => value === "deployments",
}))

const providerParams = {
	team: "team-a",
	environment: "prod-gcp",
	appName: "app-a",
	periodType: "quarterly",
	periodStart: "2026-01-01",
}
vi.mock("~/lib/evidence-providers/validation.server", () => ({
	buildProviderMetadata: vi.fn(),
	extractProviderParams: vi.fn(() => providerParams),
	getProviderSourceId: vi.fn(),
	validateProviderAccess: vi.fn(async () => {}),
	validateProviderDownloadConstraints: vi.fn(),
	validateProviderEvidenceType: vi.fn(),
}))

vi.mock("~/lib/lock.server", () => ({
	withAdvisoryLock: vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
}))

vi.mock("~/lib/logger.server", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { action } = await import("../index")

function getStatus(result: unknown): number {
	if (result instanceof Response) return result.status
	if (result && typeof result === "object" && "init" in result) {
		const init = (result as { init?: { status?: number } }).init
		return init?.status ?? 200
	}
	return 200
}

function getData<T>(result: unknown): T | null {
	if (result && typeof result === "object" && "data" in result) {
		return (result as { data: T }).data
	}
	return null
}

async function callAction(entries: Record<string, string>) {
	const formData = new FormData()
	formData.set("providerType", "deployments")
	for (const [key, value] of Object.entries(entries)) formData.set(key, value)
	try {
		return await action({
			request: new Request("http://localhost/api/evidence-download", { method: "POST", body: formData }),
			params: {},
			context: {},
		} as Parameters<typeof action>[0])
	} catch (thrown) {
		return thrown
	}
}

const app = { applicationId: "app-1", team: "team-a", environment: "prod-gcp", appName: "app-a" }
const activeState = {
	...app,
	attemptId: "attempt-1",
	jobId: "job-1",
	status: "pending" as const,
	report: null,
	error: null,
}

function activityContext(overrides: Record<string, unknown> = {}) {
	return {
		sectionId: "section-1",
		applicationId: "app-1",
		reviewStatus: "draft",
		activityStatus: "pending",
		activityType: "deployment_evidence_report",
		routineName: "Leveranserapport",
		periodConfig: {
			periodType: "quarterly",
			periodStart: "2026-01-01",
			reportGeneration: { apps: [activeState] },
		},
		...overrides,
	}
}

function reportPayload(availableFormats: string[], overrides: Record<string, unknown> = {}) {
	return {
		reportId: "report-1",
		periodType: "quarterly",
		periodStart: "2026-01-01",
		periodEnd: "2026-03-31",
		periodLabel: "Q1 2026",
		generatedAt: "2026-04-01T10:00:00Z",
		generatedBy: "Z990001",
		totalDeployments: 10,
		approvedCount: 9,
		withChangeOriginCount: 8,
		contentHash: "sha256:abc",
		availableFormats,
		...overrides,
	}
}

describe("api.evidence-download action", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockRequireAuthenticatedUser.mockResolvedValue({ navIdent: "Z990001", name: "Glad Fjord", groups: [] })
		mockRequireAnySectionRole.mockImplementation(() => {})
		mockGetActivityContext.mockResolvedValue(activityContext())
		mockGetNdaAppParamsGroup.mockResolvedValue([app])
		mockGetAppScopeIdsForApps.mockResolvedValue(new Map([["app-1", { sectionIds: ["section-1"] }]]))
		mockBeginNdaReportGeneration.mockResolvedValue({ targets: [{ ...app, attemptId: "attempt-2" }] })
		mockSaveNdaReportGenerationState.mockResolvedValue(true)
		mockProvider.requestGeneration.mockResolvedValue({ jobId: "job-2" })
	})

	describe("generate-report-set", () => {
		const validRequest = {
			intent: "generate-report-set",
			activityId: ACTIVITY_ID,
			periodType: "quarterly",
			periodStart: "2026-01-01",
			mode: "initial",
		}

		it("starts one NDA job per target and stores it as pending", async () => {
			const result = await callAction(validRequest)

			expect(getStatus(result)).toBe(200)
			expect(getData<{ success: boolean }>(result)?.success).toBe(true)
			expect(mockProvider.requestGeneration).toHaveBeenCalledTimes(1)
			expect(mockSaveNdaReportGenerationState).toHaveBeenCalledWith(
				expect.objectContaining({
					activityId: ACTIVITY_ID,
					state: expect.objectContaining({ applicationId: "app-1", status: "pending", jobId: "job-2" }),
				}),
			)
		})

		it("stores a failed state when NDA does not accept the job", async () => {
			mockProvider.requestGeneration.mockRejectedValue(new Error("NDA nede"))

			const result = await callAction(validRequest)

			expect(getStatus(result)).toBe(200)
			expect(mockSaveNdaReportGenerationState).toHaveBeenCalledWith(
				expect.objectContaining({ state: expect.objectContaining({ status: "failed", jobId: null }) }),
			)
		})

		it("rejects periods that are not ended", async () => {
			const nextYear = new Date().getFullYear() + 1
			const result = await callAction({ ...validRequest, periodType: "yearly", periodStart: `${nextYear}-01-01` })

			expect(getStatus(result)).toBe(400)
			expect(getData<{ error: string }>(result)?.error).toContain("ikke avsluttet")
			expect(mockBeginNdaReportGeneration).not.toHaveBeenCalled()
		})

		it("rejects an invalid mode", async () => {
			const result = await callAction({ ...validRequest, mode: "single-app" })

			expect(getStatus(result)).toBe(400)
			expect(mockBeginNdaReportGeneration).not.toHaveBeenCalled()
		})

		it("returns 409 when generation is already in progress", async () => {
			mockBeginNdaReportGeneration.mockRejectedValue(
				new Response("Rapportgenerering pågår allerede. Vent til den er ferdig før du prøver igjen.", { status: 409 }),
			)

			const result = await callAction(validRequest)

			expect(getStatus(result)).toBe(409)
			expect(getData<{ error: string }>(result)?.error).toContain("pågår allerede")
			expect(mockProvider.requestGeneration).not.toHaveBeenCalled()
		})
	})

	describe("poll-job", () => {
		const pollRequest = {
			intent: "poll-job",
			activityId: ACTIVITY_ID,
			jobId: "job-1",
			team: "team-a",
			environment: "prod-gcp",
			appName: "app-a",
		}

		it("rejects users without write access to the activity", async () => {
			mockGetActivityContext.mockResolvedValue(activityContext({ reviewStatus: "completed" }))

			const result = await callAction(pollRequest)

			expect(getStatus(result)).toBe(403)
			expect(mockProvider.getJobStatus).not.toHaveBeenCalled()
		})

		it("stores the report as ready when PDF and Excel are available", async () => {
			mockProvider.getJobStatus.mockResolvedValue({
				status: "completed",
				result: { report: reportPayload(["pdf", "excel"]) },
			})

			const result = await callAction(pollRequest)

			expect(getStatus(result)).toBe(200)
			expect(mockSaveNdaReportGenerationState).toHaveBeenCalledWith(
				expect.objectContaining({
					state: expect.objectContaining({ status: "ready", error: null }),
				}),
			)
		})

		it("fails the report when a format is missing", async () => {
			mockProvider.getJobStatus.mockResolvedValue({
				status: "completed",
				result: { report: reportPayload(["pdf"]) },
			})

			await callAction(pollRequest)

			expect(mockSaveNdaReportGenerationState).toHaveBeenCalledWith(
				expect.objectContaining({
					state: expect.objectContaining({ status: "failed", error: "Rapporten mangler EXCEL." }),
				}),
			)
		})

		it("fails the report when NDA returns a report for another period", async () => {
			mockProvider.getJobStatus.mockResolvedValue({
				status: "completed",
				result: { report: reportPayload(["pdf", "excel"], { periodStart: "2025-10-01" }) },
			})

			await callAction(pollRequest)

			expect(mockSaveNdaReportGenerationState).toHaveBeenCalledWith(
				expect.objectContaining({ state: expect.objectContaining({ status: "failed" }) }),
			)
		})

		it("returns 409 when the new state is rejected", async () => {
			mockProvider.getJobStatus.mockResolvedValue({
				status: "completed",
				result: { report: reportPayload(["pdf", "excel"]) },
			})
			mockSaveNdaReportGenerationState.mockResolvedValue(false)

			const result = await callAction(pollRequest)

			expect(getStatus(result)).toBe(409)
		})

		it("does not persist anything while the job is running", async () => {
			mockProvider.getJobStatus.mockResolvedValue({ status: "running" })

			const result = await callAction(pollRequest)

			expect(getStatus(result)).toBe(200)
			expect(mockSaveNdaReportGenerationState).not.toHaveBeenCalled()
		})
	})
})
