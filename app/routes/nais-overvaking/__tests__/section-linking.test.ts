import { beforeEach, describe, expect, it, vi } from "vitest"

// --- Mocks -----------------------------------------------------------

const mockGetAuthenticatedUser = vi.fn()
const mockRequireUser = vi.fn()
vi.mock("~/lib/auth.server", () => ({
	getAuthenticatedUser: mockGetAuthenticatedUser,
	requireUser: mockRequireUser,
}))

const mockLinkNaisTeamToSection = vi.fn()
const mockUnlinkNaisTeamFromSection = vi.fn()
const mockUpdateNaisTeamStatus = vi.fn()
const mockGetNaisTeams = vi.fn()
const mockGetNaisTeamAppCounts = vi.fn()
const mockGetLastSyncTimestamp = vi.fn()
vi.mock("~/db/queries/nais.server", () => ({
	getNaisTeams: mockGetNaisTeams,
	getNaisTeamAppCounts: mockGetNaisTeamAppCounts,
	getLastSyncTimestamp: mockGetLastSyncTimestamp,
	linkNaisTeamToSection: mockLinkNaisTeamToSection,
	unlinkNaisTeamFromSection: mockUnlinkNaisTeamFromSection,
	updateNaisTeamStatus: mockUpdateNaisTeamStatus,
}))

const mockGetSections = vi.fn()
vi.mock("~/db/queries/sections.server", () => ({ getSections: mockGetSections }))

vi.mock("~/lib/nais-sync-jobs.server", () => ({
	runTrackedNaisSync: vi.fn(),
}))

const { action, loader } = await import("../index")

// --- Helpers ---------------------------------------------------------

function makeRequest(formData: FormData): Request {
	return new Request("http://localhost/admin/nais-overvaking", {
		method: "POST",
		body: formData,
	})
}

function callAction(formData: FormData) {
	return action({
		request: makeRequest(formData),
		params: {},
		context: {},
	} as Parameters<typeof action>[0])
}

const testUser = {
	navIdent: "Z999999",
	name: "Test Bruker",
	groups: [],
	token: "test-token",
}

// --- Tests -----------------------------------------------------------

describe("nais-overvaking action – section linking", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockGetAuthenticatedUser.mockResolvedValue(testUser)
		mockRequireUser.mockReturnValue(testUser)
		mockGetNaisTeams.mockResolvedValue([])
		mockGetNaisTeamAppCounts.mockResolvedValue(new Map())
		mockGetLastSyncTimestamp.mockResolvedValue(null)
		mockGetSections.mockResolvedValue([])
	})

	it("links a Nais team to a section and sets status to monitored", async () => {
		const formData = new FormData()
		formData.set("intent", "link-section")
		formData.set("teamSlug", "my-team")
		formData.set("sectionId", "section-1")

		await callAction(formData)

		expect(mockLinkNaisTeamToSection).toHaveBeenCalledWith("my-team", "section-1", "Z999999")
		expect(mockUpdateNaisTeamStatus).toHaveBeenCalledWith("my-team", "monitored", "Z999999")
	})

	it("unlinks a Nais team from a section", async () => {
		const formData = new FormData()
		formData.set("intent", "unlink-section")
		formData.set("teamSlug", "my-team")

		await callAction(formData)

		expect(mockUnlinkNaisTeamFromSection).toHaveBeenCalledWith("my-team", "Z999999")
	})

	it("returns 400 when link-section is missing sectionId", async () => {
		const formData = new FormData()
		formData.set("intent", "link-section")
		formData.set("teamSlug", "my-team")

		try {
			await callAction(formData)
			expect.unreachable("Should have thrown 400")
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(Response)
			expect((thrown as Response).status).toBe(400)
		}

		expect(mockLinkNaisTeamToSection).not.toHaveBeenCalled()
	})

	it("returns 400 when link-section is missing teamSlug", async () => {
		const formData = new FormData()
		formData.set("intent", "link-section")
		formData.set("sectionId", "section-1")

		try {
			await callAction(formData)
			expect.unreachable("Should have thrown 400")
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(Response)
			expect((thrown as Response).status).toBe(400)
		}

		expect(mockLinkNaisTeamToSection).not.toHaveBeenCalled()
	})

	it("returns 400 when unlink-section is missing teamSlug", async () => {
		const formData = new FormData()
		formData.set("intent", "unlink-section")

		try {
			await callAction(formData)
			expect.unreachable("Should have thrown 400")
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(Response)
			expect((thrown as Response).status).toBe(400)
		}

		expect(mockUnlinkNaisTeamFromSection).not.toHaveBeenCalled()
	})

	it("returns 400 for unknown intent", async () => {
		const formData = new FormData()
		formData.set("intent", "invalid")

		try {
			await callAction(formData)
			expect.unreachable("Should have thrown 400")
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(Response)
			expect((thrown as Response).status).toBe(400)
		}
	})
})

describe("nais-overvaking loader", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockGetSections.mockResolvedValue([])
		mockGetLastSyncTimestamp.mockResolvedValue(null)
	})

	it("uses filtered app counts from getNaisTeamAppCounts", async () => {
		mockGetNaisTeams.mockResolvedValue([
			{
				id: "team-1",
				slug: "pensjon-q0",
				displayName: "Pensjon Q0",
				appCount: 10,
				discoveredAt: new Date("2026-05-16T10:00:00.000Z"),
				sectionId: null,
			},
		])
		mockGetNaisTeamAppCounts.mockResolvedValue(new Map([["team-1", 2]]))

		const result = await loader({
			request: new Request("http://localhost/admin/nais-overvaking"),
			params: {},
			context: {},
		} as unknown as Parameters<typeof loader>[0])

		const payload = "data" in result ? (result as { data: { teams: Array<{ appCount: number }> } }).data : null
		expect(payload?.teams[0]?.appCount).toBe(2)
	})
})
