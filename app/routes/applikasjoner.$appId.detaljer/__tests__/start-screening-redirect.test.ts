import { beforeEach, describe, expect, it, vi } from "vitest"

// --- Mocks -----------------------------------------------------------

const mockRequireAuthenticatedUser = vi.fn()
vi.mock("~/lib/auth.server", () => ({
	requireAuthenticatedUser: (...args: unknown[]) => mockRequireAuthenticatedUser(...args),
}))

vi.mock("~/lib/authorization.server", () => ({
	requireAdmin: vi.fn(),
	isAdmin: vi.fn(() => true),
	requireAppMembership: vi.fn(),
	canAccessAppReports: vi.fn(() => true),
}))

vi.mock("~/db/queries/nais.server", () => ({
	getApplicationDetail: vi.fn(),
	resolveAppNames: vi.fn(),
	getActiveAcknowledgments: vi.fn(),
	acknowledgeUnknownApp: vi.fn(),
	revokeAcknowledgment: vi.fn(),
	addManualPersistence: vi.fn(),
	archiveManualPersistence: vi.fn(),
	unarchiveManualPersistence: vi.fn(),
	updatePersistenceClassification: vi.fn(),
}))

vi.mock("~/db/queries/applications.server", () => ({
	getAppAssessments: vi.fn(),
	getAppScopeIds: vi.fn(() => []),
}))

vi.mock("~/db/queries/reports.server", () => ({
	generateAppComplianceReport: vi.fn(),
	getReportsForApp: vi.fn(() => []),
}))

const mockGetScreeningSessionsForApp = vi.fn()
const mockCaptureStateSnapshot = vi.fn()
const mockCreateScreeningSession = vi.fn()
vi.mock("~/db/queries/screening-sessions.server", () => ({
	getScreeningSessionsForApp: (...args: unknown[]) => mockGetScreeningSessionsForApp(...args),
	captureStateSnapshot: (...args: unknown[]) => mockCaptureStateSnapshot(...args),
	createScreeningSession: (...args: unknown[]) => mockCreateScreeningSession(...args),
}))

const { action } = await import("../index")

// --- Helpers ---------------------------------------------------------

const fakeUser = { navIdent: "Z990001", name: "Glad Fjord", email: "test@nav.no", groups: [], token: "", dbRoles: [] }

function makeRequest(formData: FormData, rawUrl: string): Request {
	return new Request(rawUrl, { method: "POST", body: formData })
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

async function callAction(formData: FormData, rawUrl: string, appId = "app-1") {
	return action({
		request: makeRequest(formData, rawUrl),
		params: { appId },
		url: normalizeUrl(rawUrl),
		context: {},
	} as unknown as Parameters<typeof action>[0])
}

// --- Tests -----------------------------------------------------------

describe("applikasjoner.$appId.detaljer action – start screening redirect", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockRequireAuthenticatedUser.mockResolvedValue(fakeUser)
		mockGetScreeningSessionsForApp.mockResolvedValue([])
		mockCaptureStateSnapshot.mockResolvedValue({})
		mockCreateScreeningSession.mockResolvedValue({ id: "session-1" })
	})

	it("redirects to the screening session without leaking the .data single-fetch suffix", async () => {
		const formData = new FormData()
		formData.set("intent", "create-screening-session")

		const result = (await callAction(formData, "http://localhost/applikasjoner/app-1/detaljer.data")) as Response

		expect(result.headers.get("Location")).toBe("/applikasjoner/app-1/screening/session-1")
	})

	it("preserves a context prefix (e.g. mine-team) in the redirect target", async () => {
		const formData = new FormData()
		formData.set("intent", "create-screening-session")

		const result = (await callAction(
			formData,
			"http://localhost/mine-team/applikasjoner/app-1/detaljer.data",
		)) as Response

		expect(result.headers.get("Location")).toBe("/mine-team/applikasjoner/app-1/screening/session-1")
	})
})
