import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRequireAuthenticatedUser = vi.fn()
vi.mock("~/lib/auth.server", () => ({
	requireAuthenticatedUser: mockRequireAuthenticatedUser,
}))

const mockRequireAdmin = vi.fn()
vi.mock("~/lib/authorization.server", () => ({
	requireAdmin: mockRequireAdmin,
}))

const mockGetRpaSyncJob = vi.fn()
vi.mock("~/lib/rpa-sync-jobs.server", () => ({
	getRpaSyncJob: mockGetRpaSyncJob,
}))

const { loader } = await import("../index")

function getStatus(result: unknown): number {
	if (result instanceof Response) return result.status
	if (result && typeof result === "object" && "init" in result) {
		const init = (result as { init?: { status?: number } }).init
		return init?.status ?? 200
	}
	return 200
}

function getData<T>(result: unknown): T | null {
	if (result && typeof result === "object" && "data" in result) {
		return (result as { data: T }).data
	}
	return null
}

describe("api.rpa-sync-status loader", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		const user = { navIdent: "Z123456", name: "Admin", token: "token", groups: [] }
		mockRequireAuthenticatedUser.mockResolvedValue(user)
		mockRequireAdmin.mockImplementation(() => {})
	})

	it("returns 404 when job does not exist", async () => {
		mockGetRpaSyncJob.mockResolvedValue(null)
		const response = await loader({
			request: new Request("http://localhost/api/rpa-sync-status/11111111-1111-1111-1111-111111111111"),
			params: { jobId: "11111111-1111-1111-1111-111111111111" },
			context: {},
		} as unknown as Parameters<typeof loader>[0])

		expect(getStatus(response)).toBe(404)
	})

	it("returns 400 when jobId is missing", async () => {
		const response = await loader({
			request: new Request("http://localhost/api/rpa-sync-status"),
			params: {},
			context: {},
		} as unknown as Parameters<typeof loader>[0])

		expect(getStatus(response)).toBe(400)
		expect(getData<{ error: string }>(response)?.error).toBe("Mangler jobId")
		expect(mockGetRpaSyncJob).not.toHaveBeenCalled()
	})

	it("returns job payload for existing job", async () => {
		mockGetRpaSyncJob.mockResolvedValue({
			id: "job-1",
			state: "running",
			createdAt: new Date().toISOString(),
			startedAt: new Date().toISOString(),
			finishedAt: null,
			message: "Pågår",
			result: null,
			error: null,
		})
		const response = await loader({
			request: new Request("http://localhost/api/rpa-sync-status/11111111-1111-1111-1111-111111111111"),
			params: { jobId: "11111111-1111-1111-1111-111111111111" },
			context: {},
		} as unknown as Parameters<typeof loader>[0])
		const payload = getData<{ id: string; state: string }>(response)

		expect(getStatus(response)).toBe(200)
		expect(payload?.id).toBe("job-1")
		expect(payload?.state).toBe("running")
	})

	it("returns 400 for invalid UUID format", async () => {
		const response = await loader({
			request: new Request("http://localhost/api/rpa-sync-status/invalid"),
			params: { jobId: "invalid" },
			context: {},
		} as unknown as Parameters<typeof loader>[0])

		expect(getStatus(response)).toBe(400)
		expect(getData<{ error: string }>(response)?.error).toBe("Ugyldig jobId-format")
		expect(mockGetRpaSyncJob).not.toHaveBeenCalled()
	})
})
