import { beforeEach, describe, expect, it, vi } from "vitest"

// --- Mocks -----------------------------------------------------------

const mockGetAuthenticatedUser = vi.fn()
vi.mock("~/lib/auth.server", () => ({
	getAuthenticatedUser: mockGetAuthenticatedUser,
	requireUser: vi.fn(),
}))

const mockLinkAppToTeam = vi.fn()
const mockUnlinkAppFromTeam = vi.fn()
vi.mock("~/db/queries/applications.server", () => ({
	getAppAssessments: vi.fn(),
	getAvailableTeamsForApp: vi.fn(),
	linkAppToTeam: mockLinkAppToTeam,
	unlinkAppFromTeam: mockUnlinkAppFromTeam,
}))

vi.mock("~/db/queries/nais.server", () => ({
	findLinkCandidates: vi.fn(),
	getApplicationDetail: vi.fn(),
	linkApplication: vi.fn(),
	unlinkApplication: vi.fn(),
}))

vi.mock("~/db/queries/technology-elements.server", () => ({
	getApplicationElements: vi.fn(),
	getAllTechnologyElements: vi.fn(),
	addApplicationElement: vi.fn(),
	removeApplicationElement: vi.fn(),
	confirmApplicationElement: vi.fn(),
	rejectApplicationElement: vi.fn(),
}))

vi.mock("~/lib/markdown.server", () => ({
	renderMarkdown: vi.fn(() => ""),
}))

const { action } = await import("../index")

// --- Helpers ---------------------------------------------------------

function makeRequest(formData: FormData): Request {
	return new Request("http://localhost/applikasjoner/app-1/rediger", {
		method: "POST",
		body: formData,
	})
}

function callAction(formData: FormData, appId = "app-1") {
	return action({
		request: makeRequest(formData),
		params: { appId },
		context: {},
	} as unknown as Parameters<typeof action>[0])
}

// --- Tests -----------------------------------------------------------

describe("applikasjoner.$appId.detaljer action – team linking", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("links a team to an application", async () => {
		const formData = new FormData()
		formData.set("intent", "link-team")
		formData.set("devTeamId", "team-1")

		try {
			await callAction(formData)
		} catch (thrown) {
			// redirect throws a Response
			expect(thrown).toBeInstanceOf(Response)
			expect((thrown as Response).status).toBe(302)
		}

		expect(mockLinkAppToTeam).toHaveBeenCalledWith("app-1", "team-1", "system")
	})

	it("unlinks a team from an application", async () => {
		const formData = new FormData()
		formData.set("intent", "unlink-team")
		formData.set("devTeamId", "team-1")

		try {
			await callAction(formData)
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(Response)
			expect((thrown as Response).status).toBe(302)
		}

		expect(mockUnlinkAppFromTeam).toHaveBeenCalledWith("app-1", "team-1", "system")
	})

	it("returns 400 when link-team is missing devTeamId", async () => {
		const formData = new FormData()
		formData.set("intent", "link-team")

		try {
			await callAction(formData)
			expect.unreachable("Should have thrown 400")
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(Response)
			expect((thrown as Response).status).toBe(400)
		}

		expect(mockLinkAppToTeam).not.toHaveBeenCalled()
	})

	it("returns 400 when unlink-team is missing devTeamId", async () => {
		const formData = new FormData()
		formData.set("intent", "unlink-team")

		try {
			await callAction(formData)
			expect.unreachable("Should have thrown 400")
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(Response)
			expect((thrown as Response).status).toBe(400)
		}

		expect(mockUnlinkAppFromTeam).not.toHaveBeenCalled()
	})
})
