import { beforeEach, describe, expect, it, vi } from "vitest"

// --- Mocks -----------------------------------------------------------

const mockGetAuthenticatedUser = vi.fn()
const mockRequireUser = vi.fn()
vi.mock("~/lib/auth.server", () => ({
	getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
	requireUser: (...args: unknown[]) => mockRequireUser(...args),
}))

const mockSaveScreeningSessionAnswer = vi.fn()
const mockCompleteScreeningSession = vi.fn()
const mockUpdateScreeningSessionParticipants = vi.fn()
const mockGetScreeningSession = vi.fn()
vi.mock("~/db/queries/screening-sessions.server", () => ({
	getScreeningSession: (...args: unknown[]) => mockGetScreeningSession(...args),
	saveScreeningSessionAnswer: (...args: unknown[]) => mockSaveScreeningSessionAnswer(...args),
	completeScreeningSession: (...args: unknown[]) => mockCompleteScreeningSession(...args),
	updateScreeningSessionParticipants: (...args: unknown[]) => mockUpdateScreeningSessionParticipants(...args),
}))

const mockSyncApplicationControls = vi.fn()
vi.mock("~/db/queries/application-controls.server", () => ({
	syncApplicationControls: (...args: unknown[]) => mockSyncApplicationControls(...args),
}))

vi.mock("~/lib/participants", () => ({
	parseParticipantsFormValue: (val: unknown) => (val ? JSON.parse(val as string) : []),
}))

const { action } = await import("../action.server")

// --- Helpers ---------------------------------------------------------

const fakeUser = { navIdent: "Z991234", name: "Test Bruker", email: "test@nav.no", groups: [], token: "" }

function makeRequest(formData: FormData, url = "http://localhost/applikasjoner/app-1/screening/session-1"): Request {
	return new Request(url, { method: "POST", body: formData })
}

async function callAction(formData: FormData, params = { appId: "app-1", sessionId: "session-1" }, url?: string) {
	return action({
		request: makeRequest(formData, url),
		params,
		context: {},
	} as unknown as Parameters<typeof action>[0])
}

// --- Tests -----------------------------------------------------------

describe("screening session action", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockGetAuthenticatedUser.mockResolvedValue(fakeUser)
		mockRequireUser.mockReturnValue(fakeUser)
		mockGetScreeningSession.mockResolvedValue({
			id: "session-1",
			applicationId: "app-1",
			status: "draft",
			participants: [],
			answers: [],
		})
	})

	describe("authentication", () => {
		it("requires authenticated user", async () => {
			mockRequireUser.mockImplementation(() => {
				throw new Response("Ikke innlogget", { status: 401 })
			})
			const fd = new FormData()
			fd.set("intent", "screening")
			fd.set("questionId", "q-1")
			await expect(callAction(fd)).rejects.toBeInstanceOf(Response)
		})
	})

	describe("parameter validation", () => {
		it("throws 400 when appId is missing", async () => {
			const fd = new FormData()
			fd.set("intent", "screening")
			try {
				await callAction(fd, { appId: undefined as unknown as string, sessionId: "s-1" })
				expect.fail("should have thrown")
			} catch (e) {
				expect(e).toBeInstanceOf(Response)
				expect((e as Response).status).toBe(400)
			}
		})

		it("throws 400 when sessionId is missing", async () => {
			const fd = new FormData()
			fd.set("intent", "screening")
			try {
				await callAction(fd, { appId: "app-1", sessionId: undefined as unknown as string })
				expect.fail("should have thrown")
			} catch (e) {
				expect(e).toBeInstanceOf(Response)
				expect((e as Response).status).toBe(400)
			}
		})

		it("throws 400 for unknown intent", async () => {
			const fd = new FormData()
			fd.set("intent", "unknown-intent")
			try {
				await callAction(fd)
				expect.fail("should have thrown")
			} catch (e) {
				expect(e).toBeInstanceOf(Response)
				expect((e as Response).status).toBe(400)
			}
		})
	})

	describe("session ownership", () => {
		it("throws 404 when session does not exist", async () => {
			mockGetScreeningSession.mockResolvedValue(null)
			const fd = new FormData()
			fd.set("intent", "screening")
			fd.set("questionId", "q-1")
			try {
				await callAction(fd)
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
			const fd = new FormData()
			fd.set("intent", "screening")
			fd.set("questionId", "q-1")
			try {
				await callAction(fd)
				expect.fail("should have thrown")
			} catch (e) {
				expect(e).toBeInstanceOf(Response)
				expect((e as Response).status).toBe(403)
			}
		})
	})

	describe("intent: screening (save answer)", () => {
		it("throws 400 when questionId is missing", async () => {
			const fd = new FormData()
			fd.set("intent", "screening")
			try {
				await callAction(fd)
				expect.fail("should have thrown")
			} catch (e) {
				expect(e).toBeInstanceOf(Response)
				expect((e as Response).status).toBe(400)
			}
		})

		it("calls saveScreeningSessionAnswer with correct params", async () => {
			const fd = new FormData()
			fd.set("intent", "screening")
			fd.set("questionId", "q-123")
			fd.set("answer", "ja")
			fd.set("answerComment", "En kommentar")
			fd.set("answerLink", "https://example.com")
			mockSaveScreeningSessionAnswer.mockResolvedValue(undefined)

			await callAction(fd)

			expect(mockSaveScreeningSessionAnswer).toHaveBeenCalledWith({
				sessionId: "session-1",
				questionId: "q-123",
				answer: "ja",
				comment: "En kommentar",
				link: "https://example.com",
				performedBy: "Z991234",
			})
		})

		it("passes null for empty answer fields", async () => {
			const fd = new FormData()
			fd.set("intent", "screening")
			fd.set("questionId", "q-123")
			fd.set("answer", "")
			mockSaveScreeningSessionAnswer.mockResolvedValue(undefined)

			await callAction(fd)

			expect(mockSaveScreeningSessionAnswer).toHaveBeenCalledWith(
				expect.objectContaining({
					answer: null,
					comment: null,
					link: null,
				}),
			)
		})
	})

	describe("intent: complete", () => {
		it("calls completeScreeningSession and syncApplicationControls", async () => {
			const fd = new FormData()
			fd.set("intent", "complete")
			mockCompleteScreeningSession.mockResolvedValue(undefined)
			mockSyncApplicationControls.mockResolvedValue(undefined)

			const result = await callAction(fd)

			expect(mockCompleteScreeningSession).toHaveBeenCalledWith("session-1", "Z991234")
			expect(mockSyncApplicationControls).toHaveBeenCalledWith("app-1", "Z991234")
			expect(result).toBeInstanceOf(Response)
			expect((result as Response).status).toBe(302)
		})

		it("redirects to detaljer with screeninger tab", async () => {
			const fd = new FormData()
			fd.set("intent", "complete")
			mockCompleteScreeningSession.mockResolvedValue(undefined)
			mockSyncApplicationControls.mockResolvedValue(undefined)

			const result = (await callAction(fd)) as Response
			expect(result.headers.get("Location")).toBe("/applikasjoner/app-1/detaljer?fane=screeninger")
		})

		it("redirects correctly for context-prefixed routes", async () => {
			const fd = new FormData()
			fd.set("intent", "complete")
			mockCompleteScreeningSession.mockResolvedValue(undefined)
			mockSyncApplicationControls.mockResolvedValue(undefined)

			const result = (await callAction(
				fd,
				{ appId: "app-1", sessionId: "session-1" },
				"http://localhost/mine-team/applikasjoner/app-1/screening/session-1",
			)) as Response
			expect(result.headers.get("Location")).toBe("/mine-team/applikasjoner/app-1/detaljer?fane=screeninger")
		})
	})

	describe("intent: update-participants", () => {
		it("calls updateScreeningSessionParticipants with parsed participants", async () => {
			const participants = [{ userIdent: "Z991111", userName: "Ny Deltaker" }]
			const fd = new FormData()
			fd.set("intent", "update-participants")
			fd.set("participants", JSON.stringify(participants))
			mockUpdateScreeningSessionParticipants.mockResolvedValue(undefined)

			await callAction(fd)

			expect(mockUpdateScreeningSessionParticipants).toHaveBeenCalledWith("session-1", participants, "Z991234")
		})
	})
})
