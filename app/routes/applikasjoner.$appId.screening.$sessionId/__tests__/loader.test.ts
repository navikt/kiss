import { beforeEach, describe, expect, it, vi } from "vitest"

// --- Mocks -----------------------------------------------------------

const mockRequireAuthenticatedUser = vi.fn()
const mockGetAuthenticatedUser = vi.fn()
vi.mock("~/lib/auth.server", () => ({
	requireAuthenticatedUser: (...args: unknown[]) => mockRequireAuthenticatedUser(...args),
	getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}))

vi.mock("~/lib/authorization.server", () => ({
	isAdmin: vi.fn(() => false),
}))

const mockGetScreeningSession = vi.fn()
const mockGetStagedOperations = vi.fn()
vi.mock("~/db/queries/screening-sessions.server", () => ({
	getScreeningSession: (...args: unknown[]) => mockGetScreeningSession(...args),
	getStagedOperations: (...args: unknown[]) => mockGetStagedOperations(...args),
}))

const mockGetScreeningDataForApp = vi.fn()
const mockGetScreeningQuestionsByIds = vi.fn((_ids: string[]) => Promise.resolve([]))
vi.mock("~/db/queries/screening.server", () => ({
	getScreeningDataForApp: (appId: string) => mockGetScreeningDataForApp(appId),
	getScreeningQuestionsByIds: (ids: string[]) => mockGetScreeningQuestionsByIds(ids),
}))

const mockGetApplicationDetail = vi.fn()
vi.mock("~/db/queries/nais.server", () => ({
	getApplicationDetail: (...args: unknown[]) => mockGetApplicationDetail(...args),
	getGroupAssessmentsForApp: vi.fn(() => []),
	getManualGroupsForApp: vi.fn(() => []),
	getAppPersistence: vi.fn(() => []),
}))

vi.mock("~/lib/graph.server", () => ({
	resolveGroupNames: vi.fn(() => ({})),
}))

vi.mock("~/lib/markdown.server", () => ({
	renderMarkdown: vi.fn((text: string) => `<p>${text}</p>`),
}))

vi.mock("~/db/queries/rulesets.server", () => ({
	getRulesetsForSection: vi.fn(() => []),
}))

const { loader } = await import("../loader.server")

// --- Helpers ---------------------------------------------------------

const fakeUser = { navIdent: "Z991234", name: "Test Bruker", email: "test@nav.no", groups: [], token: "" }

function makeRequest(url = "http://localhost/applikasjoner/app-1/screening/session-1"): Request {
	return new Request(url, { method: "GET" })
}

async function callLoader(params = { appId: "app-1", sessionId: "session-1" }) {
	return loader({
		request: makeRequest(),
		params,
		context: {},
	} as unknown as Parameters<typeof loader>[0])
}

// --- Tests -----------------------------------------------------------

describe("screening session loader", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockRequireAuthenticatedUser.mockResolvedValue(fakeUser)
		mockGetStagedOperations.mockResolvedValue([])
	})

	describe("parameter validation", () => {
		it("throws 400 when appId is missing", async () => {
			try {
				await callLoader({ appId: undefined as unknown as string, sessionId: "s-1" })
				expect.fail("should have thrown")
			} catch (e) {
				expect(e).toBeInstanceOf(Response)
				expect((e as Response).status).toBe(400)
			}
		})

		it("throws 400 when sessionId is missing", async () => {
			try {
				await callLoader({ appId: "app-1", sessionId: undefined as unknown as string })
				expect.fail("should have thrown")
			} catch (e) {
				expect(e).toBeInstanceOf(Response)
				expect((e as Response).status).toBe(400)
			}
		})
	})

	describe("session access control", () => {
		it("throws 404 when session does not exist", async () => {
			mockGetScreeningSession.mockResolvedValue(null)
			mockGetScreeningDataForApp.mockResolvedValue({ questions: [], sectionIds: [] })
			mockGetApplicationDetail.mockResolvedValue({ name: "app-1", authIntegrations: [] })

			try {
				await callLoader()
				expect.fail("should have thrown")
			} catch (e) {
				expect(e).toBeInstanceOf(Response)
				expect((e as Response).status).toBe(404)
			}
		})

		it("throws 403 when session belongs to a different application", async () => {
			mockGetScreeningSession.mockResolvedValue({
				id: "session-1",
				applicationId: "other-app",
				status: "draft",
				participants: [],
				answers: [],
			})
			mockGetScreeningDataForApp.mockResolvedValue({ questions: [], sectionIds: [] })
			mockGetApplicationDetail.mockResolvedValue({ name: "app-1", authIntegrations: [] })

			try {
				await callLoader()
				expect.fail("should have thrown")
			} catch (e) {
				expect(e).toBeInstanceOf(Response)
				expect((e as Response).status).toBe(403)
			}
		})

		it("throws 404 when application does not exist", async () => {
			mockGetScreeningSession.mockResolvedValue({
				id: "session-1",
				applicationId: "app-1",
				status: "draft",
				participants: [],
				answers: [],
			})
			mockGetScreeningDataForApp.mockResolvedValue({ questions: [], sectionIds: [] })
			mockGetApplicationDetail.mockResolvedValue(null)

			try {
				await callLoader()
				expect.fail("should have thrown")
			} catch (e) {
				expect(e).toBeInstanceOf(Response)
				expect((e as Response).status).toBe(404)
			}
		})
	})

	describe("successful load", () => {
		it("returns session data for valid request", async () => {
			mockGetScreeningSession.mockResolvedValue({
				id: "session-1",
				applicationId: "app-1",
				status: "draft",
				title: "Test screening",
				participants: [{ userIdent: "Z991234", userName: "Test" }],
				answers: [],
			})
			mockGetScreeningDataForApp.mockResolvedValue({ questions: [], sectionIds: [] })
			mockGetApplicationDetail.mockResolvedValue({ app: { name: "test-app" }, authIntegrations: [] })

			const result = await callLoader()

			// data() wraps in DataWithResponseInit
			const payload = "data" in result ? (result as { data: Record<string, unknown> }).data : result
			expect(payload).toHaveProperty("session")
			expect(payload).toHaveProperty("appName", "test-app")
		})

		it("uses snapshot questions for completed sessions instead of live questions", async () => {
			const snapshotQuestion = {
				id: "q-snap-1",
				questionText: "Snapshot question",
				description: null,
				displayOrder: 1,
				answerType: "boolean",
				choices: [],
				affectedControls: [],
			}
			mockGetScreeningSession.mockResolvedValue({
				id: "session-1",
				applicationId: "app-1",
				status: "completed",
				title: "Historical screening",
				participants: [],
				answers: [],
				stateSnapshot: {
					capturedAt: "2024-01-01T00:00:00.000Z",
					persistence: null,
					entraGroupsData: null,
					economyClassification: null,
					questions: [snapshotQuestion],
					rulesetOptions: [],
				},
			})
			// Live questions would be different — loader should ignore these for completed sessions
			mockGetScreeningDataForApp.mockResolvedValue({
				questions: [
					{
						id: "q-live-1",
						questionText: "Live question (should be ignored)",
						description: null,
						displayOrder: 1,
						answerType: "boolean",
						choices: [],
						affectedControls: [],
						sectionId: null,
						techElementId: null,
					},
				],
				sectionIds: [],
			})
			mockGetApplicationDetail.mockResolvedValue({ app: { name: "test-app" }, authIntegrations: [] })

			const result = await callLoader()
			const payload = "data" in result ? (result as { data: Record<string, unknown> }).data : result
			const screening = payload.screening as Array<{ id: string }>

			// Should only contain the snapshot question, not the live question
			expect(screening.map((q) => q.id)).toEqual(["q-snap-1"])
			expect(screening.map((q) => q.id)).not.toContain("q-live-1")
		})
	})
})
