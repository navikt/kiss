import { beforeEach, describe, expect, it, vi } from "vitest"

// --- Mocks -----------------------------------------------------------

const mockRequireAuthenticatedUser = vi.fn()
vi.mock("~/lib/auth.server", () => ({
	requireAuthenticatedUser: (...args: unknown[]) => mockRequireAuthenticatedUser(...args),
}))

vi.mock("~/lib/authorization.server", () => ({
	requireAdmin: vi.fn(),
	isAdmin: vi.fn(() => true),
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

function makeRequest(formData: FormData, rawUrl = "http://localhost/applikasjoner/app-1/rediger"): Request {
	return new Request(rawUrl, {
		method: "POST",
		body: formData,
	})
}

// React Router v8 leverer en normalisert `url` som søsken-argument til `request`, der
// .data-suffiks og index/_routes-søkeparametre allerede er fjernet. Simuler det her slik at
// testene reflekterer den faktiske v8-kontrakten, i stedet for å sende rå request-URL som url.
function normalizeUrl(rawUrl: string): URL {
	const normalized = new URL(rawUrl)
	normalized.pathname = normalized.pathname.replace(/\.data$/, "")
	normalized.searchParams.delete("index")
	normalized.searchParams.delete("_routes")
	return normalized
}

function callAction(formData: FormData, appId = "app-1") {
	const rawUrl = `http://localhost/applikasjoner/${appId}/rediger`
	return action({
		request: makeRequest(formData, rawUrl),
		params: { appId },
		url: normalizeUrl(rawUrl),
		context: {},
	} as unknown as Parameters<typeof action>[0])
}

// --- Tests -----------------------------------------------------------

describe("applikasjoner.$appId.detaljer action – team linking", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockRequireAuthenticatedUser.mockResolvedValue({ navIdent: "Z123456" })
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

		expect(mockLinkAppToTeam).toHaveBeenCalledWith("app-1", "team-1", "Z123456")
	})

	it("redirects to /rediger without leaking the .data single-fetch suffix", async () => {
		const formData = new FormData()
		formData.set("intent", "link-team")
		formData.set("devTeamId", "team-1")

		const rawUrl = "http://localhost/applikasjoner/app-1/rediger.data"
		const result = (await action({
			request: makeRequest(formData, rawUrl),
			params: { appId: "app-1" },
			url: normalizeUrl(rawUrl),
			context: {},
		} as unknown as Parameters<typeof action>[0])) as Response

		expect(result.headers.get("Location")).toBe("/applikasjoner/app-1/rediger")
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

		expect(mockUnlinkAppFromTeam).toHaveBeenCalledWith("app-1", "team-1", "Z123456")
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
