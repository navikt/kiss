import { beforeEach, describe, expect, it, vi } from "vitest"
import * as XLSX from "xlsx"

// Auth mock
const mockRequireAuthenticatedUser = vi.fn()
vi.mock("~/lib/auth.server", () => ({
	requireAuthenticatedUser: mockRequireAuthenticatedUser,
}))

// Authorization mock — requireReviewReadAccess is async, throws on failure
const mockRequireReviewReadAccess = vi.fn()
vi.mock("~/lib/authorization.server", () => ({
	requireReviewReadAccess: mockRequireReviewReadAccess,
}))

// Evidence-downloads mocks
const mockGetSectionIdForDownload = vi.fn()
const mockDownloadEvidenceFileFromStorage = vi.fn()
vi.mock("~/db/queries/evidence-downloads.server", () => ({
	getSectionIdForDownload: mockGetSectionIdForDownload,
	downloadEvidenceFileFromStorage: mockDownloadEvidenceFileFromStorage,
}))

const { loader } = await import("../index")

const VALID_UUID = "11111111-1111-1111-1111-111111111111"
const SECTION_ID = "22222222-2222-2222-2222-222222222222"

function fakeUser() {
	return { navIdent: "Z990001", name: "Glad Fjord", token: "token", groups: [] }
}

function makeRequest(downloadId: string, query = "") {
	const request = new Request(`http://localhost/api/evidence-file/${downloadId}${query}`)
	return {
		request,
		url: new URL(request.url),
		params: { downloadId },
		context: {},
	} as unknown as Parameters<typeof loader>[0]
}

function workbookBuffer() {
	const workbook = XLSX.utils.book_new()
	XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Kolonne"], ["<script>alert(1)</script>"]]), "Test")
	return Buffer.from(XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }))
}

describe("api.evidence-file.$downloadId loader", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockRequireAuthenticatedUser.mockResolvedValue(fakeUser())
		mockRequireReviewReadAccess.mockResolvedValue(undefined)
		mockGetSectionIdForDownload.mockResolvedValue(SECTION_ID)
		mockDownloadEvidenceFileFromStorage.mockResolvedValue({
			buffer: Buffer.from("fake-file-content"),
			contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			fileName: "oracle-snapshot.xlsx",
		})
	})

	it("returns file with correct headers for a valid download", async () => {
		const response = await loader(makeRequest(VALID_UUID))

		expect(response).toBeInstanceOf(Response)
		const res = response as Response
		expect(res.status).toBe(200)
		expect(res.headers.get("Content-Type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
		expect(res.headers.get("Content-Disposition")).toContain("oracle-snapshot.xlsx")
	})

	it("opens saved PDFs inline when view=true", async () => {
		mockDownloadEvidenceFileFromStorage.mockResolvedValue({
			buffer: Buffer.from("%PDF"),
			contentType: "application/pdf",
			fileName: "rapport.pdf",
		})

		const response = (await loader(makeRequest(VALID_UUID, "?view=true"))) as Response

		expect(response.headers.get("Content-Disposition")).toContain("inline")
		expect(response.headers.get("Content-Type")).toBe("application/pdf")
	})

	it("renders saved spreadsheets as escaped HTML when view=true", async () => {
		mockDownloadEvidenceFileFromStorage.mockResolvedValue({
			buffer: workbookBuffer(),
			contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			fileName: "rapport.xlsx",
		})

		const response = (await loader(makeRequest(VALID_UUID, "?view=true"))) as Response
		const html = await response.text()

		expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8")
		expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
		expect(html).not.toContain("<script>")
	})

	it("calls requireReviewReadAccess with the resolved sectionId", async () => {
		await loader(makeRequest(VALID_UUID))

		expect(mockGetSectionIdForDownload).toHaveBeenCalledWith(VALID_UUID)
		expect(mockRequireReviewReadAccess).toHaveBeenCalledWith(fakeUser(), { applicationId: null, sectionId: SECTION_ID })
	})

	it("returns 404 when sectionId cannot be resolved", async () => {
		mockGetSectionIdForDownload.mockResolvedValue(null)

		await expect(loader(makeRequest(VALID_UUID))).rejects.toMatchObject({ init: { status: 404 } })
		expect(mockRequireReviewReadAccess).not.toHaveBeenCalled()
	})

	it("returns 404 when file cannot be downloaded from storage", async () => {
		mockDownloadEvidenceFileFromStorage.mockResolvedValue(null)

		await expect(loader(makeRequest(VALID_UUID))).rejects.toMatchObject({ init: { status: 404 } })
	})

	it("throws 403 when requireReviewReadAccess throws", async () => {
		mockRequireReviewReadAccess.mockRejectedValue(new Response("Ikke autorisert", { status: 403 }))

		await expect(loader(makeRequest(VALID_UUID))).rejects.toMatchObject({ status: 403 })
	})

	it("returns 400 for invalid UUID format in params", async () => {
		await expect(loader(makeRequest("not-a-uuid"))).rejects.toMatchObject({ status: 400 })
		expect(mockRequireReviewReadAccess).not.toHaveBeenCalled()
	})

	it("encodes UTF-8 filenames safely in Content-Disposition header", async () => {
		mockDownloadEvidenceFileFromStorage.mockResolvedValue({
			buffer: Buffer.from("data"),
			contentType: "application/pdf",
			fileName: "rapport æøå.pdf",
		})

		const response = await loader(makeRequest(VALID_UUID))

		const res = response as Response
		const disposition = res.headers.get("Content-Disposition") ?? ""
		expect(disposition).toContain("filename*=UTF-8''")
		expect(disposition).toContain(encodeURIComponent("rapport æøå.pdf"))
	})
})
