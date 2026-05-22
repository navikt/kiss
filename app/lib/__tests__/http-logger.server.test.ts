import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockLogger = {
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
}

vi.mock("~/lib/logger.server", () => ({ logger: mockLogger }))

const { loggedFetch } = await import("~/lib/http-logger.server")

describe("loggedFetch", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
		for (const fn of Object.values(mockLogger)) fn.mockReset()
	})

	it("logs structured metadata on a successful request", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })))

		await loggedFetch("https://example.com/api/data", { method: "GET" }, { area: "test-area" })

		expect(mockLogger.info).toHaveBeenCalledOnce()
		const [message, meta] = mockLogger.info.mock.calls[0]
		expect(message).toBe("Outgoing HTTP request")
		expect(meta).toMatchObject({
			log_type: "outgoing_http",
			area: "test-area",
			method: "GET",
			host: "example.com",
			path: "/api/data",
			url: "https://example.com/api/data",
			status: 200,
			ok: true,
		})
		expect(typeof meta.durationMs).toBe("number")
	})

	it("defaults method to GET when init is undefined", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })))

		await loggedFetch("https://example.com/", undefined, { area: "test" })

		const [, meta] = mockLogger.info.mock.calls[0]
		expect(meta.method).toBe("GET")
	})

	it("logs error and rethrows on network failure", async () => {
		const networkError = new Error("Connection refused")
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(networkError))

		await expect(loggedFetch("https://example.com/api", { method: "POST" }, { area: "test-area" })).rejects.toThrow(
			"Connection refused",
		)

		expect(mockLogger.error).toHaveBeenCalledOnce()
		const [message, meta] = mockLogger.error.mock.calls[0]
		expect(message).toBe("Outgoing HTTP request failed")
		expect(meta).toMatchObject({
			log_type: "outgoing_http",
			area: "test-area",
			method: "POST",
			error: "Connection refused",
			error_name: "Error",
			stack_trace: networkError.stack,
		})
		expect(mockLogger.info).not.toHaveBeenCalled()
	})

	it("includes cause chain in error log", async () => {
		const cause = new Error("DNS lookup failed")
		const networkError = new Error("Connection refused", { cause })
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(networkError))

		await expect(loggedFetch("https://example.com/api", undefined, { area: "test" })).rejects.toThrow()

		const [, meta] = mockLogger.error.mock.calls[0]
		expect(meta.cause).toBe("DNS lookup failed")
	})

	it("redacts sensitive query parameters from the logged URL", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })))

		const url = "https://login.example.com/token?client_secret=SuperSecret&grant_type=client_credentials&scope=api"
		await loggedFetch(url, undefined, { area: "azure-ad" })

		const [, meta] = mockLogger.info.mock.calls[0]
		expect(meta.url).toContain("client_secret=%5BREDACTED%5D")
		expect(meta.url).not.toContain("SuperSecret")
		expect(meta.url).toContain("grant_type=client_credentials")
		expect(meta.url).toContain("scope=api")
	})

	it("redacts multiple sensitive parameters", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })))

		const url = "https://auth.example.com/cb?code=abc123&access_token=secretvalue&state=xyz"
		await loggedFetch(url, undefined, { area: "test" })

		const [, meta] = mockLogger.info.mock.calls[0]
		expect(meta.url).not.toContain("abc123")
		expect(meta.url).not.toContain("secretvalue")
		expect(meta.url).toContain("state=xyz")
	})

	it("handles unparseable URLs safely without leaking them", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("bad url")))

		await expect(loggedFetch("not a valid url://??##", undefined, { area: "test" })).rejects.toThrow()

		const [, meta] = mockLogger.error.mock.calls[0]
		expect(meta.url).toBe("[unparseable URL]")
		expect(meta.host).toBe("[unknown]")
	})

	it("clears userinfo (username:password) from logged URL", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })))

		const url = "https://user:password@example.com/api"
		await loggedFetch(url, undefined, { area: "test" })

		const [, meta] = mockLogger.info.mock.calls[0]
		expect(meta.url).not.toContain("user:password")
		expect(meta.url).not.toContain("password")
	})

	it("logs non-ok responses at info level (HTTP errors are not network failures)", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Not Found", { status: 404 })))

		const response = await loggedFetch("https://example.com/missing", undefined, { area: "test" })

		expect(response.status).toBe(404)
		expect(mockLogger.info).toHaveBeenCalledOnce()
		const [, meta] = mockLogger.info.mock.calls[0]
		expect(meta.status).toBe(404)
		expect(meta.ok).toBe(false)
		expect(mockLogger.error).not.toHaveBeenCalled()
	})

	it("redacts sensitive params from relative URLs and includes pathname in url field", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })))

		await loggedFetch("/api/token?access_token=secret&scope=read", undefined, { area: "test" })

		const [, meta] = mockLogger.info.mock.calls[0]
		expect(meta.url).not.toContain("secret")
		expect(meta.url).toContain("/api/token")
		expect(meta.url).toContain("scope=read")
		expect(meta.host).toBe("[relative]")
	})
})
