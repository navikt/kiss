import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Mock environment variables before importing the module
vi.stubEnv("AZURE_OPENID_CONFIG_TOKEN_ENDPOINT", "https://login.microsoftonline.com/tenant/oauth2/v2.0/token")
vi.stubEnv("AZURE_APP_CLIENT_ID", "test-client-id")
vi.stubEnv("AZURE_APP_CLIENT_SECRET", "test-secret")

const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

const { getClientCredentialToken } = await import("~/lib/azure.server")

function mockTokenResponse(expiresIn = 3600, tokenValue?: string) {
	return new Response(JSON.stringify({ access_token: tokenValue ?? `token-${Math.random()}`, expires_in: expiresIn }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	})
}

describe("getClientCredentialToken cache", () => {
	beforeEach(() => {
		mockFetch.mockReset()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("should fetch a new token on first call", async () => {
		mockFetch.mockResolvedValueOnce(mockTokenResponse())

		const token = await getClientCredentialToken("api://scope/.default")

		expect(mockFetch).toHaveBeenCalledTimes(1)
		expect(token).toContain("token-")
	})

	it("should return cached token on subsequent calls with same scope", async () => {
		mockFetch.mockResolvedValueOnce(mockTokenResponse())

		const token1 = await getClientCredentialToken("api://scope-a/.default")
		const token2 = await getClientCredentialToken("api://scope-a/.default")

		expect(mockFetch).toHaveBeenCalledTimes(1)
		expect(token1).toBe(token2)
	})

	it("should fetch separately for different scopes", async () => {
		mockFetch.mockResolvedValueOnce(mockTokenResponse())
		mockFetch.mockResolvedValueOnce(mockTokenResponse())

		const token1 = await getClientCredentialToken("api://scope-x/.default")
		const token2 = await getClientCredentialToken("api://scope-y/.default")

		expect(mockFetch).toHaveBeenCalledTimes(2)
		expect(token1).not.toBe(token2)
	})

	it("should refetch when cached token has expired", async () => {
		vi.useFakeTimers()
		mockFetch.mockResolvedValueOnce(mockTokenResponse(600, "first-token"))
		mockFetch.mockResolvedValueOnce(mockTokenResponse(3600, "second-token"))

		const token1 = await getClientCredentialToken("api://expiring/.default")
		expect(token1).toBe("first-token")

		// Advance past expiry (10 min - 5 min buffer = 5 min effective)
		vi.advanceTimersByTime(6 * 60 * 1000)

		const token2 = await getClientCredentialToken("api://expiring/.default")

		expect(mockFetch).toHaveBeenCalledTimes(2)
		expect(token2).toBe("second-token")

		vi.useRealTimers()
	})

	it("should use cached token before expiry buffer", async () => {
		vi.useFakeTimers()
		mockFetch.mockResolvedValueOnce(mockTokenResponse(3600, "cached-token"))

		const token1 = await getClientCredentialToken("api://valid/.default")

		// Advance 50 min (still within 55 min effective TTL)
		vi.advanceTimersByTime(50 * 60 * 1000)

		const token2 = await getClientCredentialToken("api://valid/.default")

		expect(mockFetch).toHaveBeenCalledTimes(1)
		expect(token1).toBe("cached-token")
		expect(token2).toBe("cached-token")

		vi.useRealTimers()
	})
})
