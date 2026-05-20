import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.stubEnv("GITHUB_APP_ID", "12345")
vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "67890")
vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "dummy-key")

const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

afterAll(() => {
	vi.unstubAllEnvs()
	vi.unstubAllGlobals()
})

// Mock jose with a class-based SignJWT
vi.mock("jose", () => {
	class MockSignJWT {
		setProtectedHeader() {
			return this
		}
		setIssuer() {
			return this
		}
		setIssuedAt() {
			return this
		}
		setExpirationTime() {
			return this
		}
		async sign() {
			return "mock-jwt"
		}
	}
	return {
		importJWK: vi.fn().mockResolvedValue("mock-key"),
		SignJWT: MockSignJWT,
	}
})

vi.mock("node:crypto", () => ({
	default: {
		createPrivateKey: () => ({
			export: () => ({ kty: "RSA", n: "test", e: "AQAB", d: "test" }),
		}),
	},
}))

const { parseLinkNext, getRepoTeams, getRepoCollaborators, getTeamMembers, isGitHubAppConfigured, clearTokenCache } =
	await import("~/lib/github.server")

describe("parseLinkNext", () => {
	it("returns null for null header", () => {
		expect(parseLinkNext(null)).toBeNull()
	})

	it("returns null when no next rel", () => {
		expect(parseLinkNext('<https://api.github.com/repos?page=1>; rel="prev"')).toBeNull()
	})

	it("extracts next URL from link header", () => {
		const header =
			'<https://api.github.com/repos/navikt/pen/teams?page=2&per_page=100>; rel="next", <https://api.github.com/repos/navikt/pen/teams?page=5>; rel="last"'
		expect(parseLinkNext(header)).toBe("https://api.github.com/repos/navikt/pen/teams?page=2&per_page=100")
	})

	it("handles next as only link", () => {
		expect(parseLinkNext('<https://api.github.com/next?page=3>; rel="next"')).toBe("https://api.github.com/next?page=3")
	})
})

describe("isGitHubAppConfigured", () => {
	it("returns true when all env vars set", () => {
		expect(isGitHubAppConfigured()).toBe(true)
	})
})

describe("getRepoTeams", () => {
	beforeEach(() => {
		mockFetch.mockReset()
		clearTokenCache()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	function mockInstallationToken() {
		mockFetch.mockResolvedValueOnce(
			new Response(JSON.stringify({ token: "ghs_test", expires_at: new Date(Date.now() + 3600000).toISOString() }), {
				status: 200,
			}),
		)
	}

	it("fetches and maps teams correctly", async () => {
		mockInstallationToken()
		mockFetch.mockResolvedValueOnce(
			new Response(JSON.stringify([{ slug: "team-a", name: "Team A", permission: "push" }]), {
				status: 200,
				headers: { link: "" },
			}),
		)

		const teams = await getRepoTeams("navikt", "pen")
		expect(teams).toEqual([{ slug: "team-a", name: "Team A", permission: "push" }])
	})

	it("follows pagination", async () => {
		mockInstallationToken()
		// Page 1
		mockFetch.mockResolvedValueOnce(
			new Response(JSON.stringify([{ slug: "t1", name: "T1", permission: "admin" }]), {
				status: 200,
				headers: { link: '<https://api.github.com/repos/navikt/pen/teams?page=2&per_page=100>; rel="next"' },
			}),
		)
		// Page 2
		mockFetch.mockResolvedValueOnce(
			new Response(JSON.stringify([{ slug: "t2", name: "T2", permission: "pull" }]), {
				status: 200,
				headers: { link: "" },
			}),
		)

		const teams = await getRepoTeams("navikt", "pen")
		expect(teams).toHaveLength(2)
		expect(teams[0].slug).toBe("t1")
		expect(teams[1].slug).toBe("t2")
	})

	it("throws on non-2xx response", async () => {
		mockInstallationToken()
		mockFetch.mockResolvedValueOnce(new Response("Not Found", { status: 404 }))

		await expect(getRepoTeams("navikt", "missing")).rejects.toThrow("GitHub API error: 404")
	})
})

describe("getRepoCollaborators", () => {
	beforeEach(() => {
		mockFetch.mockReset()
		clearTokenCache()
	})

	function mockInstallationToken() {
		mockFetch.mockResolvedValueOnce(
			new Response(JSON.stringify({ token: "ghs_test", expires_at: new Date(Date.now() + 3600000).toISOString() }), {
				status: 200,
			}),
		)
	}

	it("fetches direct collaborators", async () => {
		mockInstallationToken()
		mockFetch.mockResolvedValueOnce(
			new Response(JSON.stringify([{ login: "user1", role_name: "admin" }]), {
				status: 200,
				headers: { link: "" },
			}),
		)

		const collabs = await getRepoCollaborators("navikt", "pen")
		expect(collabs).toEqual([{ login: "user1", role_name: "admin" }])
	})
})

describe("getTeamMembers", () => {
	beforeEach(() => {
		mockFetch.mockReset()
		clearTokenCache()
	})

	function mockInstallationToken() {
		mockFetch.mockResolvedValueOnce(
			new Response(JSON.stringify({ token: "ghs_test", expires_at: new Date(Date.now() + 3600000).toISOString() }), {
				status: 200,
			}),
		)
	}

	it("distinguishes maintainers from members", async () => {
		mockInstallationToken()
		// All members
		mockFetch.mockResolvedValueOnce(
			new Response(JSON.stringify([{ login: "alice" }, { login: "bob" }, { login: "charlie" }]), {
				status: 200,
				headers: { link: "" },
			}),
		)
		// Maintainers only
		mockFetch.mockResolvedValueOnce(
			new Response(JSON.stringify([{ login: "alice" }]), {
				status: 200,
				headers: { link: "" },
			}),
		)

		const members = await getTeamMembers("navikt", "team-a")
		expect(members).toEqual([
			{ login: "alice", role: "maintainer" },
			{ login: "bob", role: "member" },
			{ login: "charlie", role: "member" },
		])
	})
})

describe("token caching and in-flight deduplication", () => {
	beforeEach(() => {
		mockFetch.mockReset()
		clearTokenCache()
	})

	function mockInstallationTokenResponse(token = "ghs_cached", expiresInMs = 3600000) {
		return new Response(JSON.stringify({ token, expires_at: new Date(Date.now() + expiresInMs).toISOString() }), {
			status: 200,
		})
	}

	function mockTeamsResponse() {
		return new Response(JSON.stringify([{ slug: "t", name: "T", permission: "push" }]), {
			status: 200,
			headers: { link: "" },
		})
	}

	it("reuses cached token across multiple calls", async () => {
		// First call: token request + API call
		mockFetch.mockResolvedValueOnce(mockInstallationTokenResponse())
		mockFetch.mockResolvedValueOnce(mockTeamsResponse())

		await getRepoTeams("navikt", "app1")

		// Second call: should reuse cached token (no new token request)
		mockFetch.mockResolvedValueOnce(mockTeamsResponse())

		await getRepoTeams("navikt", "app2")

		// Total fetch calls: 1 token + 1 API + 1 API = 3 (NOT 2 tokens + 2 APIs = 4)
		expect(mockFetch).toHaveBeenCalledTimes(3)
		// First call was token request
		expect(mockFetch.mock.calls[0][0]).toContain("/access_tokens")
		// Second call was teams API
		expect(mockFetch.mock.calls[1][0]).toContain("/teams")
		// Third call was teams API (no additional token request)
		expect(mockFetch.mock.calls[2][0]).toContain("/teams")
	})

	it("deduplicates concurrent token requests", async () => {
		// Set up a delayed token response to ensure concurrency
		let resolveToken: ((r: Response) => void) | undefined
		const tokenPromise = new Promise<Response>((resolve) => {
			resolveToken = resolve
		})
		mockFetch.mockImplementationOnce(() => tokenPromise)

		// Queue up API responses for both parallel calls
		mockFetch.mockResolvedValueOnce(mockTeamsResponse())
		mockFetch.mockResolvedValueOnce(mockTeamsResponse())

		// Fire two requests in parallel
		const p1 = getRepoTeams("navikt", "app1")
		const p2 = getRepoTeams("navikt", "app2")

		// Resolve the token request
		resolveToken?.(mockInstallationTokenResponse())

		await Promise.all([p1, p2])

		// Only 1 token request should have been made (deduplicated), plus 2 API calls
		expect(mockFetch).toHaveBeenCalledTimes(3)
		const tokenCalls = mockFetch.mock.calls.filter((c) => (c[0] as string).includes("/access_tokens"))
		expect(tokenCalls).toHaveLength(1)
	})

	it("refreshes token when less than 5 minutes remaining", async () => {
		// First call: token that expires in 1 minute (< 5 min buffer)
		mockFetch.mockResolvedValueOnce(mockInstallationTokenResponse("ghs_short", 60_000))
		mockFetch.mockResolvedValueOnce(mockTeamsResponse())

		await getRepoTeams("navikt", "app1")

		// Second call: should request a NEW token because cached one expires too soon
		mockFetch.mockResolvedValueOnce(mockInstallationTokenResponse("ghs_fresh", 3600000))
		mockFetch.mockResolvedValueOnce(mockTeamsResponse())

		await getRepoTeams("navikt", "app2")

		// Total: 2 token requests + 2 API calls = 4
		expect(mockFetch).toHaveBeenCalledTimes(4)
		const tokenCalls = mockFetch.mock.calls.filter((c) => (c[0] as string).includes("/access_tokens"))
		expect(tokenCalls).toHaveLength(2)
	})
})
