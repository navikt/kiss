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

const { fetchTeamEntraMembers } = await import("~/lib/graph.server")

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

describe("fetchTeamEntraMembers", () => {
	afterEach(() => {
		vi.unstubAllGlobals()
		vi.unstubAllEnvs()
		vi.restoreAllMocks()
	})

	it("bruker /transitiveMembers og select inkl. onPremisesSamAccountName", async () => {
		vi.stubEnv("AZURE_OPENID_CONFIG_TOKEN_ENDPOINT", "https://example.test/token")
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ value: [] }))
		vi.stubGlobal("fetch", fetchMock)

		await fetchTeamEntraMembers("11111111-1111-1111-1111-111111111111")

		const calledUrl = new URL(fetchMock.mock.calls[0][0] as string)
		expect(calledUrl.pathname).toContain("/transitiveMembers")
		expect(calledUrl.searchParams.get("$select")).toContain("onPremisesSamAccountName")
	})

	it("filtrerer bort ikke-brukere og deaktiverte kontoer, utleder navIdent", async () => {
		vi.stubEnv("AZURE_OPENID_CONFIG_TOKEN_ENDPOINT", "https://example.test/token")
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				jsonResponse({
					value: [
						{
							"@odata.type": "#microsoft.graph.user",
							accountEnabled: true,
							displayName: "Glad Fjord",
							mail: "glad.fjord@nav.no",
							onPremisesSamAccountName: "Z990001",
						},
						{
							"@odata.type": "#microsoft.graph.user",
							accountEnabled: false,
							displayName: "Deaktivert Bruker",
							onPremisesSamAccountName: "Z990002",
						},
						{
							"@odata.type": "#microsoft.graph.group",
							displayName: "Nøstet gruppe",
						},
						{
							"@odata.type": "#microsoft.graph.user",
							accountEnabled: true,
							displayName: "Uten NAV-ident",
						},
					],
				}),
			),
		)

		const result = await fetchTeamEntraMembers("11111111-1111-1111-1111-111111111111")

		expect(result).toEqual([{ navIdent: "Z990001", displayName: "Glad Fjord", mail: "glad.fjord@nav.no" }])
	})

	it("dedupliserer medlemmer med samme navIdent på tvers av sider", async () => {
		vi.stubEnv("AZURE_OPENID_CONFIG_TOKEN_ENDPOINT", "https://example.test/token")
		const page1 = jsonResponse({
			value: [
				{
					"@odata.type": "#microsoft.graph.user",
					accountEnabled: true,
					displayName: "Rask Elv",
					onPremisesSamAccountName: "Z990003",
				},
			],
			"@odata.nextLink": "https://graph.microsoft.com/v1.0/next-page",
		})
		const page2 = jsonResponse({
			value: [
				{
					"@odata.type": "#microsoft.graph.user",
					accountEnabled: true,
					displayName: "Rask Elv",
					onPremisesSamAccountName: "Z990003",
				},
			],
		})
		vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2))

		const result = await fetchTeamEntraMembers("11111111-1111-1111-1111-111111111111")

		expect(result).toHaveLength(1)
		expect(result?.[0].navIdent).toBe("Z990003")
	})

	it("returnerer null når Graph svarer Request_ResourceNotFound (gruppe slettet)", async () => {
		vi.stubEnv("AZURE_OPENID_CONFIG_TOKEN_ENDPOINT", "https://example.test/token")
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(jsonResponse({ error: { code: "Request_ResourceNotFound" } }, 404)),
		)

		const result = await fetchTeamEntraMembers("00000000-0000-0000-0000-000000000000")

		expect(result).toBeNull()
	})

	it("kaster på andre feil enn Request_ResourceNotFound (behold cache i kalleren)", async () => {
		vi.stubEnv("AZURE_OPENID_CONFIG_TOKEN_ENDPOINT", "https://example.test/token")
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: { code: "ServiceUnavailable" } }, 503)))

		await expect(fetchTeamEntraMembers("11111111-1111-1111-1111-111111111111")).rejects.toThrow()
	})

	it("kaster på 404 uten Request_ResourceNotFound-kode (f.eks. ugyldig ID)", async () => {
		vi.stubEnv("AZURE_OPENID_CONFIG_TOKEN_ENDPOINT", "https://example.test/token")
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: { code: "InvalidRequest" } }, 404)))

		await expect(fetchTeamEntraMembers("11111111-1111-1111-1111-111111111111")).rejects.toThrow()
	})
})
