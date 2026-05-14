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
vi.mock("~/db/queries/nais.server", () => ({
	getNaisTeams: vi.fn().mockResolvedValue([]),
	getNaisTeamAppCounts: vi.fn().mockResolvedValue(new Map()),
	getLastSyncTimestamp: vi.fn().mockResolvedValue(null),
	linkNaisTeamToSection: mockLinkNaisTeamToSection,
	unlinkNaisTeamFromSection: mockUnlinkNaisTeamFromSection,
	updateNaisTeamStatus: mockUpdateNaisTeamStatus,
}))

vi.mock("~/db/queries/sections.server", () => ({
	getSections: vi.fn().mockResolvedValue([]),
}))

vi.mock("~/lib/nais-sync-jobs.server", () => ({
	runTrackedNaisSync: vi.fn(),
}))

const { action } = await import("../index")

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
