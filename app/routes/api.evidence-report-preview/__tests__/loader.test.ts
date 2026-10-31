import { beforeEach, describe, expect, it, vi } from "vitest"
import * as XLSX from "xlsx"

const mockGetActivityContext = vi.fn()
const mockGetNdaAppParamsGroup = vi.fn()
const mockRequireAuthenticatedUser = vi.fn()
const mockRequireReviewReadAccess = vi.fn()
const mockGetEvidenceProvider = vi.fn()
const mockValidateProviderAccess = vi.fn()
const mockDownloadFile = vi.fn()

vi.mock("~/db/queries/evidence-downloads.server", () => ({
	getActivityContext: mockGetActivityContext,
}))
vi.mock("~/db/queries/deployment-audit.server", () => ({
	getNdaAppParamsGroup: mockGetNdaAppParamsGroup,
}))
vi.mock("~/lib/auth.server", () => ({
	requireAuthenticatedUser: mockRequireAuthenticatedUser,
}))
vi.mock("~/lib/authorization.server", () => ({
	requireReviewReadAccess: mockRequireReviewReadAccess,
}))
vi.mock("~/lib/evidence-providers/index.server", () => ({
	getEvidenceProvider: mockGetEvidenceProvider,
}))
vi.mock("~/lib/evidence-providers/validation.server", () => ({
	validateProviderAccess: mockValidateProviderAccess,
}))

const { loader } = await import("../index")

const ACTIVITY_ID = "11111111-1111-1111-1111-111111111111"
const APPLICATION_ID = "22222222-2222-2222-2222-222222222222"
const SECTION_ID = "33333333-3333-3333-3333-333333333333"

const reportSnapshot = {
	reportId: "nda-report-1",
	periodType: "quarterly",
	periodStart: "2026-01-01",
	periodEnd: "2026-03-31",
	periodLabel: "Q1 2026",
	generatedAt: "2026-04-01T10:00:00Z",
	generatedBy: "Z990001",
	totalDeployments: 5,
	approvedCount: 5,
	withChangeOriginCount: 5,
	contentHash: "sha256:test",
	availableFormats: ["pdf", "excel"],
}

function makeContext() {
	return {
		activityId: ACTIVITY_ID,
		activityType: "deployment_evidence_report",
		activityStatus: "pending",
		reviewStatus: "draft",
		applicationId: APPLICATION_ID,
		sectionId: SECTION_ID,
		periodConfig: {
			periodType: "quarterly",
			periodStart: "2026-01-01",
			reportGeneration: {
				apps: [
					{
						applicationId: APPLICATION_ID,
						team: "team-a",
						environment: "prod-gcp",
						appName: "app-a",
						attemptId: "attempt-1",
						jobId: null,
						status: "ready",
						report: reportSnapshot,
						error: null,
					},
				],
			},
		},
	}
}

function makeRequest(format = "pdf", overrides: Record<string, string> = {}) {
	const params = new URLSearchParams({
		activityId: ACTIVITY_ID,
		applicationId: APPLICATION_ID,
		attemptId: "attempt-1",
		reportId: reportSnapshot.reportId,
		format,
		...overrides,
	})
	return {
		request: new Request(`http://localhost/api/evidence-report-preview?${params}`),
		params: {},
		context: {},
	} as unknown as Parameters<typeof loader>[0]
}

function workbookBuffer() {
	const workbook = XLSX.utils.book_new()
	XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Rapport"], ["NDA-rapport"]]), "Oppsummering")
	return Buffer.from(XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }))
}

describe("api.evidence-report-preview loader", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockGetActivityContext.mockResolvedValue(makeContext())
		mockGetNdaAppParamsGroup.mockResolvedValue([
			{ applicationId: APPLICATION_ID, team: "team-a", environment: "prod-gcp", appName: "app-a" },
		])
		mockRequireAuthenticatedUser.mockResolvedValue({ navIdent: "Z990001", groups: [] })
		mockRequireReviewReadAccess.mockResolvedValue(undefined)
		mockValidateProviderAccess.mockResolvedValue(undefined)
		mockDownloadFile.mockResolvedValue({
			buffer: Buffer.from("%PDF-1.4"),
			contentType: "application/pdf",
			fileName: "nda-report-1.pdf",
		})
		mockGetEvidenceProvider.mockResolvedValue({ downloadFile: mockDownloadFile })
	})

	it("streams a ready PDF inline without recording it as evidence", async () => {
		const response = (await loader(makeRequest())) as Response

		expect(response.headers.get("Content-Type")).toBe("application/pdf")
		expect(response.headers.get("Content-Disposition")).toContain("inline")
		expect(mockDownloadFile).toHaveBeenCalledWith(
			{
				team: "team-a",
				environment: "prod-gcp",
				appName: "app-a",
				periodType: "quarterly",
				periodStart: "2026-01-01",
			},
			reportSnapshot.reportId,
			"pdf",
		)
	})

	it("renders a ready Excel report as a spreadsheet preview", async () => {
		mockDownloadFile.mockResolvedValue({
			buffer: workbookBuffer(),
			contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			fileName: "nda-report-1.xlsx",
		})

		const response = (await loader(makeRequest("excel"))) as Response
		const html = await response.text()

		expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8")
		expect(html).toContain("Skrivebeskyttet visning av regnearket.")
		expect(html).toContain("NDA-rapport")
	})

	it("rejects a stale report attempt", async () => {
		await expect(loader(makeRequest("pdf", { attemptId: "old-attempt" }))).rejects.toMatchObject({
			init: { status: 404 },
		})
		expect(mockDownloadFile).not.toHaveBeenCalled()
	})
})
