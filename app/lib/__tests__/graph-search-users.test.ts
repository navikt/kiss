import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/azure.server", () => ({
	getClientCredentialToken: vi.fn(async () => "mock-token"),
}))

vi.mock("~/lib/logger.server", () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

const { searchUsers } = await import("~/lib/graph.server")

function mockFetchSuccess(users: object[] = []) {
	return vi.fn().mockResolvedValue(
		new Response(JSON.stringify({ value: users }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		}),
	)
}

describe("searchUsers — URL-bygging", () => {
	afterEach(() => {
		vi.unstubAllGlobals()
		vi.unstubAllEnvs()
		vi.restoreAllMocks()
	})

	it("bruker $filter med eksakt NAV-ident-oppslag for ident-format", async () => {
		vi.stubEnv("AZURE_OPENID_CONFIG_TOKEN_ENDPOINT", "https://example.test/token")
		const fetchMock = mockFetchSuccess()
		vi.stubGlobal("fetch", fetchMock)

		await searchUsers("Z990042")

		const calledUrl = new URL(fetchMock.mock.calls[0][0] as string)
		expect(calledUrl.searchParams.get("$filter")).toBe(
			"onPremisesSamAccountName eq 'Z990042' or mailNickname eq 'z990042'",
		)
		expect(calledUrl.searchParams.get("$search")).toBeNull()
		expect(calledUrl.searchParams.get("$count")).toBe("true")
	})

	it("bruker $search med ord-splitting for navnesøk", async () => {
		vi.stubEnv("AZURE_OPENID_CONFIG_TOKEN_ENDPOINT", "https://example.test/token")
		const fetchMock = mockFetchSuccess()
		vi.stubGlobal("fetch", fetchMock)

		await searchUsers("Glad Fjord")

		const calledUrl = new URL(fetchMock.mock.calls[0][0] as string)
		expect(calledUrl.searchParams.get("$search")).toBe('"displayName:Glad" "displayName:Fjord"')
		expect(calledUrl.searchParams.get("$filter")).toBeNull()
		expect(calledUrl.searchParams.get("$count")).toBe("true")
	})

	it("finner Fjord, Glad ved søk på 'Glad Fjord' (rekkefølgeuavhengig)", async () => {
		vi.stubEnv("AZURE_OPENID_CONFIG_TOKEN_ENDPOINT", "https://example.test/token")
		const fetchMock = mockFetchSuccess([
			{
				id: "1",
				displayName: "Fjord, Glad",
				mail: "glad.fjord@nav.no",
				onPremisesSamAccountName: "Z990042",
				mailNickname: "z990042",
			},
		])
		vi.stubGlobal("fetch", fetchMock)

		const results = await searchUsers("Glad Fjord")
		expect(results).toHaveLength(1)
		expect(results[0].navIdent).toBe("Z990042")
		expect(results[0].displayName).toBe("Fjord, Glad")
	})

	it("returnerer tom liste når søkeord forsvinner etter sanitering", async () => {
		vi.stubEnv("AZURE_OPENID_CONFIG_TOKEN_ENDPOINT", "https://example.test/token")
		const fetchMock = mockFetchSuccess()
		vi.stubGlobal("fetch", fetchMock)

		const results = await searchUsers('",\\')
		expect(results).toEqual([])
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it("sender ConsistencyLevel: eventual for $search-kall", async () => {
		vi.stubEnv("AZURE_OPENID_CONFIG_TOKEN_ENDPOINT", "https://example.test/token")
		const fetchMock = mockFetchSuccess()
		vi.stubGlobal("fetch", fetchMock)

		await searchUsers("Rask Elv")

		const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>
		expect(headers.ConsistencyLevel).toBe("eventual")
	})
})
