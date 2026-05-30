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

const mockAcknowledgeUnknownApp = vi.fn()
const mockRevokeAcknowledgment = vi.fn()
vi.mock("~/db/queries/nais.server", () => ({
	getApplicationDetail: vi.fn(),
	resolveAppNames: vi.fn(),
	getActiveAcknowledgments: vi.fn(),
	acknowledgeUnknownApp: mockAcknowledgeUnknownApp,
	revokeAcknowledgment: mockRevokeAcknowledgment,
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
	// data() wraps payload in { type: "DataWithResponseInit", data: ... }
	if (result && typeof result === "object" && "data" in result) {
		return (result as { data: unknown }).data as Record<string, unknown>
	}
	return result as unknown as Record<string, unknown>
}

// --- Tests -----------------------------------------------------------

describe("applikasjoner.$appId.detaljer action – acknowledgments", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockRequireAuthenticatedUser.mockResolvedValue(fakeUser)
	})

	describe("acknowledge-app", () => {
		it("acknowledges an unknown app with comment", async () => {
			const formData = new FormData()
			formData.set("intent", "acknowledge-app")
			formData.set("ruleApplication", "some-external-app")
			formData.set("comment", "Denne appen kjører on-prem og er en gyldig integrasjon")

			const result = await callAction(formData)

			expect(mockAcknowledgeUnknownApp).toHaveBeenCalledWith(
				"app-1",
				"some-external-app",
				"Denne appen kjører on-prem og er en gyldig integrasjon",
				"T123456",
			)
			// data() returns the payload directly (wrapped by react-router internals)
			expect(result).toMatchObject({ success: true })
		})

		it("rejects empty comment", async () => {
			const formData = new FormData()
			formData.set("intent", "acknowledge-app")
			formData.set("ruleApplication", "some-external-app")
			formData.set("comment", "")

			const result = await callAction(formData)

			expect(result).toMatchObject({ success: false })
			expect(mockAcknowledgeUnknownApp).not.toHaveBeenCalled()
		})

		it("rejects whitespace-only comment", async () => {
			const formData = new FormData()
			formData.set("intent", "acknowledge-app")
			formData.set("ruleApplication", "some-external-app")
			formData.set("comment", "   ")

			const result = await callAction(formData)

			expect(result).toMatchObject({ success: false })
			expect(mockAcknowledgeUnknownApp).not.toHaveBeenCalled()
		})

		it("returns 400 when ruleApplication is missing", async () => {
			const formData = new FormData()
			formData.set("intent", "acknowledge-app")
			formData.set("comment", "En kommentar")

			try {
				await callAction(formData)
				expect.unreachable("Should have thrown 400")
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(400)
			}

			expect(mockAcknowledgeUnknownApp).not.toHaveBeenCalled()
		})
	})

	describe("revoke-acknowledgment", () => {
		it("revokes an acknowledgment", async () => {
			const formData = new FormData()
			formData.set("intent", "revoke-acknowledgment")
			formData.set("ruleApplication", "some-external-app")

			const result = await callAction(formData)

			expect(result).toMatchObject({ success: true })
			expect(mockRevokeAcknowledgment).toHaveBeenCalledWith("app-1", "some-external-app", "T123456")
		})

		it("returns 400 when ruleApplication is missing", async () => {
			const formData = new FormData()
			formData.set("intent", "revoke-acknowledgment")

			try {
				await callAction(formData)
				expect.unreachable("Should have thrown 400")
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(400)
			}

			expect(mockRevokeAcknowledgment).not.toHaveBeenCalled()
		})
	})
})
