import { beforeEach, describe, expect, it, vi } from "vitest"

// --- Mocks -----------------------------------------------------------

const mockGetAuthenticatedUser = vi.fn()
const mockRequireUser = vi.fn()
vi.mock("~/lib/auth.server", () => ({
	getAuthenticatedUser: mockGetAuthenticatedUser,
	requireUser: (...args: unknown[]) => mockRequireUser(...args),
}))

const mockIsAdmin = vi.fn(() => true)
vi.mock("~/lib/authorization.server", () => ({
	requireAdmin: vi.fn(),
	isAdmin: mockIsAdmin,
}))

const mockUpsertOracleProfileCriticality = vi.fn()
const mockIsInstanceLinkedToApp = vi.fn(() => true)
vi.mock("~/db/queries/oracle-profiles.server", () => ({
	upsertOracleProfileCriticality: mockUpsertOracleProfileCriticality,
	isInstanceLinkedToApp: mockIsInstanceLinkedToApp,
}))

vi.mock("~/db/queries/nais.server", () => ({
	getApplicationDetail: vi.fn(),
	resolveAppNames: vi.fn(),
	getActiveAcknowledgments: vi.fn(),
	acknowledgeUnknownApp: vi.fn(),
	revokeAcknowledgment: vi.fn(),
}))

vi.mock("~/db/queries/applications.server", () => ({
	getAppAssessments: vi.fn(),
}))

vi.mock("~/db/queries/audit-evidence.server", () => ({
	getLatestSnapshot: vi.fn(),
	getOracleInstancesForApp: vi.fn(() => []),
}))

vi.mock("~/db/queries/reports.server", () => ({
	generateAppComplianceReport: vi.fn(),
	getReportsForApp: vi.fn(() => []),
}))

vi.mock("~/db/queries/routines.server", () => ({
	createReview: vi.fn(),
	getReviewsForApp: vi.fn(() => []),
	getRoutineDeadlinesForApp: vi.fn(() => []),
}))

vi.mock("~/db/queries/sections.server", () => ({
	getSections: vi.fn(() => []),
}))

const { action } = await import("../index")

// --- Helpers ---------------------------------------------------------

const fakeUser = { navIdent: "T123456", name: "Test Bruker", email: "test@nav.no", groups: [], token: "", dbRoles: [] }

function makeRequest(formData: FormData): Request {
	return new Request("http://localhost/applikasjoner/app-1/detaljer", {
		method: "POST",
		body: formData,
	})
}

async function callAction(formData: FormData, appId = "app-1") {
	const result = await action({
		request: makeRequest(formData),
		params: { appId },
		context: {},
	} as unknown as Parameters<typeof action>[0])
	if (result && typeof result === "object" && "data" in result) {
		return (result as { data: unknown }).data as Record<string, unknown>
	}
	return result as unknown as Record<string, unknown>
}

// --- Tests -----------------------------------------------------------

describe("applikasjoner.$appId.detaljer action – set-oracle-profile-criticality", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockGetAuthenticatedUser.mockResolvedValue(fakeUser)
		mockRequireUser.mockReturnValue(fakeUser)
		mockIsAdmin.mockReturnValue(true)
		mockIsInstanceLinkedToApp.mockResolvedValue(true)
		mockUpsertOracleProfileCriticality.mockResolvedValue({})
	})

	it("updates profile criticality for admin user", async () => {
		const formData = new FormData()
		formData.set("intent", "set-oracle-profile-criticality")
		formData.set("instanceId", "pensjon-db-01")
		formData.set("profileName", "DEFAULT")
		formData.set("criticality", "high")

		const result = await callAction(formData)

		expect(result).toMatchObject({ success: true })
		expect(mockUpsertOracleProfileCriticality).toHaveBeenCalledWith(
			"app-1",
			"pensjon-db-01",
			"DEFAULT",
			"high",
			"T123456",
		)
	})

	it("rejects non-admin users", async () => {
		mockIsAdmin.mockReturnValue(false)

		const formData = new FormData()
		formData.set("intent", "set-oracle-profile-criticality")
		formData.set("instanceId", "pensjon-db-01")
		formData.set("profileName", "DEFAULT")
		formData.set("criticality", "high")

		const result = await callAction(formData)

		expect(result).toMatchObject({ success: false, error: "Ikke autorisert" })
		expect(mockUpsertOracleProfileCriticality).not.toHaveBeenCalled()
	})

	it("rejects missing instanceId", async () => {
		const formData = new FormData()
		formData.set("intent", "set-oracle-profile-criticality")
		formData.set("profileName", "DEFAULT")
		formData.set("criticality", "high")

		const result = await callAction(formData)

		expect(result).toMatchObject({ success: false })
		expect(mockUpsertOracleProfileCriticality).not.toHaveBeenCalled()
	})

	it("rejects missing profileName", async () => {
		const formData = new FormData()
		formData.set("intent", "set-oracle-profile-criticality")
		formData.set("instanceId", "pensjon-db-01")
		formData.set("criticality", "high")

		const result = await callAction(formData)

		expect(result).toMatchObject({ success: false })
		expect(mockUpsertOracleProfileCriticality).not.toHaveBeenCalled()
	})

	it("rejects invalid criticality value", async () => {
		const formData = new FormData()
		formData.set("intent", "set-oracle-profile-criticality")
		formData.set("instanceId", "pensjon-db-01")
		formData.set("profileName", "DEFAULT")
		formData.set("criticality", "invalid_value")

		const result = await callAction(formData)

		expect(result).toMatchObject({ success: false, error: "Ugyldig kritikalitet" })
		expect(mockUpsertOracleProfileCriticality).not.toHaveBeenCalled()
	})

	it("rejects when instance is not linked to app", async () => {
		mockIsInstanceLinkedToApp.mockResolvedValue(false)

		const formData = new FormData()
		formData.set("intent", "set-oracle-profile-criticality")
		formData.set("instanceId", "unlinked-db-01")
		formData.set("profileName", "DEFAULT")
		formData.set("criticality", "low")

		const result = await callAction(formData)

		expect(result).toMatchObject({ success: false, error: "Instansen er ikke knyttet til denne applikasjonen" })
		expect(mockUpsertOracleProfileCriticality).not.toHaveBeenCalled()
	})
})
