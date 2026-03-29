import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fetchNaisApps, fetchNaisTeams } from "../nais.server"

const NAIS_API_URL = "https://console.nav.cloud.nais.io/graphql"

const noMorePages = { hasNextPage: false, endCursor: null }

function mockFetchResponse(body: unknown, status = 200) {
	return vi.fn().mockResolvedValue({
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(body),
		text: () => Promise.resolve(JSON.stringify(body)),
	})
}

describe("fetchNaisTeams", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", mockFetchResponse({ data: { teams: { pageInfo: noMorePages, nodes: [] } } }))
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("calls the Nais GraphQL endpoint with correct headers", async () => {
		await fetchNaisTeams("test-token")

		expect(fetch).toHaveBeenCalledWith(NAIS_API_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer test-token",
			},
			body: expect.stringContaining("teams"),
		})
	})

	it("omits Authorization header when no token is provided", async () => {
		await fetchNaisTeams()

		expect(fetch).toHaveBeenCalledWith(NAIS_API_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: expect.stringContaining("teams"),
		})
	})

	it("returns the list of teams from the response", async () => {
		const teams = [
			{ slug: "team-a", purpose: "Frontend" },
			{ slug: "team-b", purpose: "Backend" },
		]
		vi.stubGlobal("fetch", mockFetchResponse({ data: { teams: { pageInfo: noMorePages, nodes: teams } } }))

		const result = await fetchNaisTeams("token")
		expect(result).toEqual(teams)
	})

	it("paginates through multiple pages", async () => {
		const page1 = {
			data: {
				teams: { pageInfo: { hasNextPage: true, endCursor: "cursor1" }, nodes: [{ slug: "team-a", purpose: "A" }] },
			},
		}
		const page2 = { data: { teams: { pageInfo: noMorePages, nodes: [{ slug: "team-b", purpose: "B" }] } } }
		const mockFetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: () => Promise.resolve(page1),
				text: () => Promise.resolve(""),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: () => Promise.resolve(page2),
				text: () => Promise.resolve(""),
			})
		vi.stubGlobal("fetch", mockFetch)

		const result = await fetchNaisTeams("token")
		expect(result).toEqual([
			{ slug: "team-a", purpose: "A" },
			{ slug: "team-b", purpose: "B" },
		])
		expect(mockFetch).toHaveBeenCalledTimes(2)

		const body2 = JSON.parse(mockFetch.mock.calls[1][1].body)
		expect(body2.variables.after).toBe("cursor1")
	})

	it("throws on HTTP error response", async () => {
		vi.stubGlobal("fetch", mockFetchResponse("Internal Server Error", 500))

		await expect(fetchNaisTeams("token")).rejects.toThrow("Nais API request failed: 500")
	})

	it("throws on GraphQL errors in response", async () => {
		vi.stubGlobal(
			"fetch",
			mockFetchResponse({
				data: null,
				errors: [{ message: "Unauthorized" }],
			}),
		)

		await expect(fetchNaisTeams("token")).rejects.toThrow("Nais GraphQL errors: Unauthorized")
	})

	it("throws when response has no data", async () => {
		vi.stubGlobal("fetch", mockFetchResponse({}))

		await expect(fetchNaisTeams("token")).rejects.toThrow("Nais API returned no data")
	})
})

describe("fetchNaisApps", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("sends the team slug as a GraphQL variable", async () => {
		vi.stubGlobal("fetch", mockFetchResponse({ data: { team: { apps: { pageInfo: noMorePages, nodes: [] } } } }))

		await fetchNaisApps("token", "my-team")

		const callBody = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
		expect(callBody.variables.slug).toBe("my-team")
		expect(callBody.variables.first).toBe(100)
	})

	it("returns the list of apps from the response", async () => {
		const apps = [
			{
				name: "my-app",
				namespace: "my-team",
				cluster: "prod-gcp",
				image: "ghcr.io/my-app:latest",
				deployInfo: {
					timestamp: "2024-01-15T12:00:00Z",
					deployer: "deploy-bot",
				},
			},
		]
		vi.stubGlobal("fetch", mockFetchResponse({ data: { team: { apps: { pageInfo: noMorePages, nodes: apps } } } }))

		const result = await fetchNaisApps("token", "my-team")
		expect(result).toEqual(apps)
	})

	it("throws on GraphQL errors", async () => {
		vi.stubGlobal(
			"fetch",
			mockFetchResponse({
				errors: [{ message: "Team not found" }],
			}),
		)

		await expect(fetchNaisApps("token", "bad-team")).rejects.toThrow("Nais GraphQL errors: Team not found")
	})
})
