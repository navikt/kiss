import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRequireAuthenticatedUser = vi.fn()
vi.mock("~/lib/auth.server", () => ({
	requireAuthenticatedUser: mockRequireAuthenticatedUser,
}))

const mockCanAccessAppReports = vi.fn()
const mockCanViewReviewDetail = vi.fn()
const mockIsAdmin = vi.fn()
const mockIsAuditor = vi.fn()
const mockCanManageSection = vi.fn()
vi.mock("~/lib/authorization.server", () => ({
	canAccessAppReports: mockCanAccessAppReports,
	canViewReviewDetail: mockCanViewReviewDetail,
	canManageSection: mockCanManageSection,
	isAdmin: mockIsAdmin,
	isAuditor: mockIsAuditor,
}))

const mockGetReport = vi.fn()
vi.mock("~/db/queries/reports.server", () => ({
	getReport: mockGetReport,
}))

const mockGetReviewDetailAccessScopes = vi.fn()
vi.mock("~/db/queries/routines.server", () => ({
	getReviewDetailAccessScopes: mockGetReviewDetailAccessScopes,
}))

const mockGetAppScopeIds = vi.fn()
vi.mock("~/db/queries/applications.server", () => ({
	getAppScopeIds: mockGetAppScopeIds,
}))

vi.mock("~/db/connection.server", () => ({
	db: {},
}))

const mockDownload = vi.fn()
const mockExists = vi.fn()
vi.mock("~/lib/storage/index.server", () => ({
	getStorageProvider: () => ({
		download: mockDownload,
		downloadStream: vi.fn(),
		exists: mockExists,
	}),
}))

const { loader } = await import("../index")

const RAPPORT_ID = "11111111-1111-1111-1111-111111111111"
const APP_ID = "22222222-2222-2222-2222-222222222222"
const REVIEW_ID_1 = "33333333-3333-3333-3333-333333333333"
const REVIEW_ID_2 = "44444444-4444-4444-4444-444444444444"

function fakeUser() {
	return { navIdent: "Z990001", name: "Glad Fjord", token: "token", groups: [] }
}

function makeRequest(download = false) {
	const url = `http://localhost/api/rapporter/${RAPPORT_ID}/pdf${download ? "?download=true" : ""}`
	return {
		request: new Request(url),
		params: { rapportId: RAPPORT_ID },
		url: new URL(url),
	} as unknown as Parameters<typeof loader>[0]
}

function baseAppComplianceReport(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		id: RAPPORT_ID,
		reportType: "app_compliance",
		scopeId: APP_ID,
		reviewIds: [REVIEW_ID_1, REVIEW_ID_2],
		reportBucketPath: "reports/app.pdf",
		name: "Rapport",
		status: "completed",
		snapshotBucketPath: null,
		...overrides,
	}
}

function baseRoutineReviewReport(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		id: RAPPORT_ID,
		reportType: "routine_review",
		scopeId: APP_ID,
		reviewIds: [REVIEW_ID_1, REVIEW_ID_2],
		reportBucketPath: "reports/routine-review.pdf",
		name: "Rapport",
		status: "completed",
		snapshotBucketPath: null,
		...overrides,
	}
}

describe("api.rapporter.$rapportId.pdf loader — app_compliance access control", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockRequireAuthenticatedUser.mockResolvedValue(fakeUser())
		mockGetAppScopeIds.mockResolvedValue({ devTeamIds: [], sectionIds: [] })
		mockCanAccessAppReports.mockReturnValue(true)
		mockIsAdmin.mockReturnValue(false)
		mockDownload.mockResolvedValue(Buffer.from("pdf-bytes"))
		mockExists.mockResolvedValue(true)
	})

	it("denies non-admin download when user lacks access to one of the report's reviewIds", async () => {
		mockGetReport.mockResolvedValue(baseAppComplianceReport())
		mockGetReviewDetailAccessScopes.mockResolvedValue(
			new Map([
				[REVIEW_ID_1, { responsibleRole: null, sectionId: "s1", status: "completed", createdBy: "Z990002" }],
				[REVIEW_ID_2, { responsibleRole: null, sectionId: "s1", status: "completed", createdBy: "Z990002" }],
			]),
		)
		mockCanViewReviewDetail.mockImplementation((_, scope) => scope.sectionId === "only-visible-section")

		await expect(loader(makeRequest())).rejects.toMatchObject({ status: 403 })
	})

	it("allows non-admin download when user has access to all of the report's reviewIds", async () => {
		mockGetReport.mockResolvedValue(baseAppComplianceReport())
		mockGetReviewDetailAccessScopes.mockResolvedValue(
			new Map([
				[REVIEW_ID_1, { responsibleRole: null, sectionId: "s1", status: "completed", createdBy: "Z990002" }],
				[REVIEW_ID_2, { responsibleRole: null, sectionId: "s1", status: "completed", createdBy: "Z990002" }],
			]),
		)
		mockCanViewReviewDetail.mockReturnValue(true)

		const response = await loader(makeRequest())

		expect(response).toBeInstanceOf(Response)
		expect((response as Response).status).toBe(200)
	})

	it("allows non-admin download when reviewIds is an empty list (report includes no reviews)", async () => {
		mockGetReport.mockResolvedValue(baseAppComplianceReport({ reviewIds: [] }))
		mockGetReviewDetailAccessScopes.mockResolvedValue(new Map())

		const response = await loader(makeRequest())

		expect(response).toBeInstanceOf(Response)
		expect((response as Response).status).toBe(200)
		expect(mockGetReviewDetailAccessScopes).toHaveBeenCalledWith([])
	})

	it("denies non-admin download for legacy reports with no persisted reviewIds", async () => {
		mockGetReport.mockResolvedValue(baseAppComplianceReport({ reviewIds: null }))

		await expect(loader(makeRequest())).rejects.toMatchObject({ status: 403 })
		expect(mockGetReviewDetailAccessScopes).not.toHaveBeenCalled()
	})

	it("allows admin download regardless of reviewIds access", async () => {
		mockIsAdmin.mockReturnValue(true)
		mockGetReport.mockResolvedValue(baseAppComplianceReport({ reviewIds: null }))

		const response = await loader(makeRequest())

		expect(response).toBeInstanceOf(Response)
		expect((response as Response).status).toBe(200)
		expect(mockGetReviewDetailAccessScopes).not.toHaveBeenCalled()
	})
})

describe("api.rapporter.$rapportId.pdf loader — routine_review access control", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockRequireAuthenticatedUser.mockResolvedValue(fakeUser())
		mockGetAppScopeIds.mockResolvedValue({ devTeamIds: [], sectionIds: [] })
		mockCanAccessAppReports.mockReturnValue(true)
		mockIsAdmin.mockReturnValue(false)
		mockDownload.mockResolvedValue(Buffer.from("pdf-bytes"))
		mockExists.mockResolvedValue(true)
	})

	it("denies non-admin download when user lacks access to one of the report's reviewIds", async () => {
		mockGetReport.mockResolvedValue(baseRoutineReviewReport())
		mockGetReviewDetailAccessScopes.mockResolvedValue(
			new Map([
				[REVIEW_ID_1, { responsibleRole: null, sectionId: "s1", status: "completed", createdBy: "Z990002" }],
				[REVIEW_ID_2, { responsibleRole: null, sectionId: "s1", status: "completed", createdBy: "Z990002" }],
			]),
		)
		mockCanViewReviewDetail.mockImplementation((_, scope) => scope.sectionId === "only-visible-section")

		await expect(loader(makeRequest())).rejects.toMatchObject({ status: 403 })
	})

	it("allows non-admin download when user has access to all of the report's reviewIds", async () => {
		mockGetReport.mockResolvedValue(baseRoutineReviewReport())
		mockGetReviewDetailAccessScopes.mockResolvedValue(
			new Map([
				[REVIEW_ID_1, { responsibleRole: null, sectionId: "s1", status: "completed", createdBy: "Z990002" }],
				[REVIEW_ID_2, { responsibleRole: null, sectionId: "s1", status: "completed", createdBy: "Z990002" }],
			]),
		)
		mockCanViewReviewDetail.mockReturnValue(true)

		const response = await loader(makeRequest())

		expect(response).toBeInstanceOf(Response)
		expect((response as Response).status).toBe(200)
	})

	it("allows non-admin download when reviewIds is an empty list (report includes no reviews)", async () => {
		mockGetReport.mockResolvedValue(baseRoutineReviewReport({ reviewIds: [] }))
		mockGetReviewDetailAccessScopes.mockResolvedValue(new Map())

		const response = await loader(makeRequest())

		expect(response).toBeInstanceOf(Response)
		expect((response as Response).status).toBe(200)
		expect(mockGetReviewDetailAccessScopes).toHaveBeenCalledWith([])
	})

	it("denies non-admin download for legacy reports with no persisted reviewIds", async () => {
		mockGetReport.mockResolvedValue(baseRoutineReviewReport({ reviewIds: null }))

		await expect(loader(makeRequest())).rejects.toMatchObject({ status: 403 })
		expect(mockGetReviewDetailAccessScopes).not.toHaveBeenCalled()
	})

	it("allows admin download regardless of reviewIds access", async () => {
		mockIsAdmin.mockReturnValue(true)
		mockGetReport.mockResolvedValue(baseRoutineReviewReport({ reviewIds: null }))

		const response = await loader(makeRequest())

		expect(response).toBeInstanceOf(Response)
		expect((response as Response).status).toBe(200)
		expect(mockGetReviewDetailAccessScopes).not.toHaveBeenCalled()
	})
})
