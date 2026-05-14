import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/azure.server", () => ({
	getClientCredentialToken: vi.fn(async () => "token"),
}))

vi.mock("~/lib/logger.server", () => ({
	logger: {
		warn: vi.fn(),
	},
}))

const { fetchUserGroupMemberships, _testing } = await import("~/lib/graph.server")

describe("graph retry behavior", () => {
	afterEach(() => {
		vi.unstubAllGlobals()
		vi.unstubAllEnvs()
		vi.restoreAllMocks()
	})

	it("parseRetryAfterMs parses seconds and dates", () => {
		expect(_testing.parseRetryAfterMs("2")).toBe(2000)
		expect(_testing.parseRetryAfterMs("invalid")).toBeNull()
		expect(_testing.parseRetryAfterMs(null)).toBeNull()
	})

	it("retries memberOf request on 429 and succeeds", async () => {
		vi.stubEnv("AZURE_OPENID_CONFIG_TOKEN_ENDPOINT", "https://example.test/token")
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response("{}", {
					status: 429,
					headers: { "retry-after": "0" },
				}),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						value: [{ "@odata.type": "#microsoft.graph.group", id: "g1", displayName: "Group 1" }],
					}),
					{ status: 200 },
				),
			)

		vi.stubGlobal("fetch", fetchMock)

		const groups = await fetchUserGroupMemberships("user-1")
		expect(groups).toEqual([{ groupId: "g1", displayName: "Group 1" }])
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})

	it("fails after max 429 retries", async () => {
		vi.stubEnv("AZURE_OPENID_CONFIG_TOKEN_ENDPOINT", "https://example.test/token")
		const fetchMock = vi.fn().mockResolvedValue(
			new Response("{}", {
				status: 429,
				headers: { "retry-after": "0" },
			}),
		)
		vi.stubGlobal("fetch", fetchMock)

		await expect(fetchUserGroupMemberships("user-1")).rejects.toThrow(
			"Graph memberOf request failed for user user-1: 429",
		)
		expect(fetchMock).toHaveBeenCalledTimes(4)
	})
})
