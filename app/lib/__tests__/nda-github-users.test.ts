import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/azure.server", () => ({
	getClientCredentialToken: vi.fn().mockResolvedValue("mock-token"),
}))

vi.mock("~/lib/logger.server", () => ({
	logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

describe("NDA GitHub user lookup", () => {
	const originalEnv = { ...process.env }

	beforeEach(() => {
		process.env.NDA_AUDIT_REPORTS_BASE_URL = "https://nda.example.com"
		process.env.NDA_AUDIT_REPORTS_SCOPE = "api://nda/.default"
		vi.resetModules()
	})

	afterEach(() => {
		process.env = { ...originalEnv }
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	it("deduplicates usernames and returns lookup results keyed by GitHub username", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			Response.json({
				users: [
					{
						githubUsername: "glad-fjord",
						displayName: "Glad Fjord",
						navIdent: "Z990001",
						found: true,
					},
					{
						githubUsername: "ukjent-bruker",
						displayName: null,
						navIdent: null,
						found: false,
					},
				],
			}),
		)

		const { lookupGitHubUsers } = await import("../nda-github-users.server")
		const result = await lookupGitHubUsers(["glad-fjord", "ukjent-bruker", "glad-fjord"])

		expect(fetchSpy).toHaveBeenCalledOnce()
		const [url, options] = fetchSpy.mock.calls[0]
		expect(url).toBe("https://nda.example.com/api/v1/users/github-lookup")
		expect(options?.method).toBe("POST")
		expect(options?.headers).toEqual({
			Authorization: "Bearer mock-token",
			"Content-Type": "application/json",
		})
		expect(options?.signal).toBeInstanceOf(AbortSignal)
		expect(JSON.parse(options?.body as string)).toEqual({
			githubUsernames: ["glad-fjord", "ukjent-bruker"],
		})
		expect(result.get("glad-fjord")).toEqual({
			githubUsername: "glad-fjord",
			displayName: "Glad Fjord",
			navIdent: "Z990001",
			found: true,
		})
		expect(result.get("ukjent-bruker")?.found).toBe(false)
	})

	it("splits requests into batches of at most 500 usernames", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
			const body = JSON.parse(options?.body as string) as { githubUsernames: string[] }
			return Response.json({
				users: body.githubUsernames.map((githubUsername) => ({
					githubUsername,
					displayName: `Name ${githubUsername}`,
					navIdent: null,
					found: true,
				})),
			})
		})

		const { lookupGitHubUsers } = await import("../nda-github-users.server")
		const result = await lookupGitHubUsers(Array.from({ length: 501 }, (_, index) => `user-${index}`))

		expect(fetchSpy).toHaveBeenCalledTimes(2)
		const requestSizes = fetchSpy.mock.calls.map(([, options]) => {
			const body = JSON.parse(options?.body as string) as { githubUsernames: string[] }
			return body.githubUsernames.length
		})
		expect(requestSizes).toEqual([500, 1])
		expect(result.size).toBe(501)
	})

	it("runs at most three batch requests concurrently", async () => {
		const pendingRequests: Array<() => void> = []
		let activeRequests = 0
		let maxActiveRequests = 0
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
			const body = JSON.parse(options?.body as string) as { githubUsernames: string[] }
			activeRequests += 1
			maxActiveRequests = Math.max(maxActiveRequests, activeRequests)
			await new Promise<void>((resolve) => {
				pendingRequests.push(() => {
					activeRequests -= 1
					resolve()
				})
			})
			return Response.json({
				users: body.githubUsernames.map((githubUsername) => ({
					githubUsername,
					displayName: null,
					navIdent: null,
					found: false,
				})),
			})
		})

		const { lookupGitHubUsers } = await import("../nda-github-users.server")
		const lookupPromise = lookupGitHubUsers(Array.from({ length: 2_001 }, (_, index) => `user-${index}`))

		await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3))
		pendingRequests.splice(0).forEach((resolve) => {
			resolve()
		})
		await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(5))
		pendingRequests.splice(0).forEach((resolve) => {
			resolve()
		})

		const result = await lookupPromise
		expect(maxActiveRequests).toBe(3)
		expect(result.size).toBe(2_001)
	})

	it("forwards cancellation from the calling request", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
			(_url, options) =>
				new Promise((_resolve, reject) => {
					if (!(options?.signal instanceof AbortSignal)) {
						reject(new Error("Expected request signal"))
						return
					}
					options.signal.addEventListener("abort", () => reject(options.signal?.reason), { once: true })
				}),
		)
		const controller = new AbortController()

		const { lookupGitHubUsers } = await import("../nda-github-users.server")
		const lookupPromise = lookupGitHubUsers(["glad-fjord"], { signal: controller.signal })
		const rejection = expect(lookupPromise).rejects.toThrow()
		await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce())
		const [, options] = fetchSpy.mock.calls[0]
		if (!(options?.signal instanceof AbortSignal)) {
			throw new Error("Expected request signal")
		}
		controller.abort()

		await rejection
		expect(options.signal.aborted).toBe(true)
	})

	it("times out while waiting for the access token", async () => {
		const timeoutController = new AbortController()
		const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutController.signal)
		const { getClientCredentialToken } = await import("../azure.server")
		vi.mocked(getClientCredentialToken).mockImplementationOnce(
			(_targetScope, options) =>
				new Promise((_resolve, reject) => {
					options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true })
				}),
		)
		const fetchSpy = vi.spyOn(globalThis, "fetch")

		const { lookupGitHubUsers } = await import("../nda-github-users.server")
		const lookupPromise = lookupGitHubUsers(["glad-fjord"])
		const rejection = expect(lookupPromise).rejects.toThrow()
		timeoutController.abort(new DOMException("Timed out", "TimeoutError"))

		await rejection
		expect(timeoutSpy).toHaveBeenCalledWith(5_000)
		expect(getClientCredentialToken).toHaveBeenCalledWith("api://nda/.default", {
			signal: timeoutController.signal,
		})
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it("uses a separate timeout for token acquisition and each batch request", async () => {
		const timeoutSpy = vi.spyOn(AbortSignal, "timeout")
		vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
			const body = JSON.parse(options?.body as string) as { githubUsernames: string[] }
			return Response.json({
				users: body.githubUsernames.map((githubUsername) => ({
					githubUsername,
					displayName: null,
					navIdent: null,
					found: false,
				})),
			})
		})

		const { lookupGitHubUsers } = await import("../nda-github-users.server")
		await lookupGitHubUsers(Array.from({ length: 501 }, (_, index) => `user-${index}`))

		expect(timeoutSpy).toHaveBeenCalledTimes(3)
		expect(timeoutSpy).toHaveBeenNthCalledWith(1, 5_000)
		expect(timeoutSpy).toHaveBeenNthCalledWith(2, 5_000)
		expect(timeoutSpy).toHaveBeenNthCalledWith(3, 5_000)
	})

	it("does not call NDA when no valid usernames are provided", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch")

		const { lookupGitHubUsers } = await import("../nda-github-users.server")
		const result = await lookupGitHubUsers(["", "  "])

		expect(fetchSpy).not.toHaveBeenCalled()
		expect(result.size).toBe(0)
	})

	it("throws when NDA returns an error", async () => {
		const response = Response.json({ error: "Not deployed" }, { status: 404 })
		vi.spyOn(globalThis, "fetch").mockResolvedValue(response)

		const { lookupGitHubUsers } = await import("../nda-github-users.server")

		await expect(lookupGitHubUsers(["glad-fjord"])).rejects.toThrow("404")
		expect(response.bodyUsed).toBe(true)
	})

	it("rejects an invalid response contract", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ users: [{ githubUsername: "glad-fjord" }] }))

		const { lookupGitHubUsers } = await import("../nda-github-users.server")

		await expect(lookupGitHubUsers(["glad-fjord"])).rejects.toThrow()
	})
})
