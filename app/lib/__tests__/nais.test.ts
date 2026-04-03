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
		vi.stubGlobal(
			"fetch",
			mockFetchResponse({
				data: { team: { applications: { pageInfo: noMorePages, nodes: [] } } },
			}),
		)

		await fetchNaisApps("token", "my-team")

		const callBody = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
		expect(callBody.variables.slug).toBe("my-team")
		expect(callBody.variables.first).toBe(100)
	})

	it("returns the list of apps from the response", async () => {
		const nodes = [
			{
				name: "my-app",
				image: { name: "my-registry/my-app" },
				manifest: null,
				authIntegrations: [],
				teamEnvironment: { environment: { name: "prod-gcp" } },
				sqlInstances: { nodes: [] },
				postgresInstances: { nodes: [] },
				openSearch: null,
				buckets: { nodes: [] },
				valkeys: { nodes: [] },
				deployments: { nodes: [] },
			},
		]
		vi.stubGlobal(
			"fetch",
			mockFetchResponse({
				data: { team: { applications: { pageInfo: noMorePages, nodes } } },
			}),
		)

		const result = await fetchNaisApps("token", "my-team")
		expect(result).toEqual([
			{
				name: "my-app",
				namespace: "my-team",
				cluster: "prod-gcp",
				image: "my-registry/my-app",
				persistence: [],
				authIntegrations: [],
			},
		])
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

	it("extracts persistence resources from the response", async () => {
		const nodes = [
			{
				name: "my-app",
				image: null,
				manifest: null,
				authIntegrations: [],
				teamEnvironment: { environment: { name: "prod-gcp" } },
				sqlInstances: {
					nodes: [
						{
							name: "my-db",
							version: "POSTGRES_16",
							tier: "db-f1-micro",
							highAvailability: false,
							auditLog: null,
							flags: { nodes: [] },
						},
					],
				},
				postgresInstances: { nodes: [] },
				openSearch: { name: "my-search" },
				buckets: { nodes: [{ name: "my-bucket" }] },
				valkeys: { nodes: [{ name: "my-cache" }] },
				deployments: { nodes: [] },
			},
		]
		vi.stubGlobal(
			"fetch",
			mockFetchResponse({
				data: { team: { applications: { pageInfo: noMorePages, nodes } } },
			}),
		)

		const result = await fetchNaisApps("token", "my-team")
		expect(result[0].persistence).toEqual([
			{
				type: "cloud_sql_postgres",
				name: "my-db",
				version: "POSTGRES_16",
				tier: "db-f1-micro",
				highAvailability: false,
				auditLogging: false,
				auditLogUrl: undefined,
				flags: undefined,
			},
			{ type: "opensearch", name: "my-search" },
			{ type: "bucket", name: "my-bucket" },
			{ type: "valkey", name: "my-cache" },
		])
	})

	it("detects pgaudit flags and audit log URL", async () => {
		const nodes = [
			{
				name: "audit-app",
				image: null,
				manifest: null,
				authIntegrations: [],
				teamEnvironment: { environment: { name: "prod-gcp" } },
				sqlInstances: {
					nodes: [
						{
							name: "audit-db",
							version: "POSTGRES_17",
							tier: "db-custom-1-3840",
							highAvailability: true,
							auditLog: { logUrl: "https://console.cloud.google.com/logs" },
							flags: {
								nodes: [
									{ name: "cloudsql.enable_pgaudit", value: "on" },
									{ name: "pgaudit.log", value: "write,ddl,role" },
								],
							},
						},
					],
				},
				postgresInstances: { nodes: [] },
				openSearch: null,
				buckets: { nodes: [] },
				valkeys: { nodes: [] },
				deployments: { nodes: [] },
			},
		]
		vi.stubGlobal(
			"fetch",
			mockFetchResponse({
				data: { team: { applications: { pageInfo: noMorePages, nodes } } },
			}),
		)

		const result = await fetchNaisApps("token", "my-team")
		const db = result[0].persistence[0]
		expect(db.auditLogging).toBe(true)
		expect(db.auditLogUrl).toBe("https://console.cloud.google.com/logs")
		expect(db.flags).toEqual({
			"cloudsql.enable_pgaudit": "on",
			"pgaudit.log": "write,ddl,role",
		})
	})

	it("detects Oracle databases from vault paths in manifest", async () => {
		const manifest = `apiVersion: nais.io/v1alpha1
kind: Application
spec:
  vault:
    enabled: true
    paths:
    - kvPath: oracle/data/prod/creds/pen-user
      mountPath: /secrets/oracle
    - kvPath: oracle/data/prod/config/pen
      mountPath: /secrets/oracle-config
    - kvPath: serviceuser/data/prod/srvpen
      mountPath: /secrets/srvpen`

		const nodes = [
			{
				name: "oracle-app",
				image: null,
				manifest: { content: manifest },
				authIntegrations: [],
				teamEnvironment: { environment: { name: "prod-fss" } },
				sqlInstances: { nodes: [] },
				postgresInstances: { nodes: [] },
				openSearch: null,
				buckets: { nodes: [] },
				valkeys: { nodes: [] },
				deployments: { nodes: [] },
			},
		]
		vi.stubGlobal(
			"fetch",
			mockFetchResponse({
				data: { team: { applications: { pageInfo: noMorePages, nodes } } },
			}),
		)

		const result = await fetchNaisApps("token", "my-team")
		expect(result[0].persistence).toEqual([{ type: "oracle", name: "pen" }])
	})

	it("detects on-prem PostgreSQL from envFrom secrets in manifest", async () => {
		const manifest = `apiVersion: nais.io/v1alpha1
kind: Application
spec:
  envFrom:
  - secret: my-app-unleash-api-token
  - secret: my-app-postgresql
  - secret: my-app-encryption-key`

		const nodes = [
			{
				name: "my-app",
				image: null,
				manifest: { content: manifest },
				authIntegrations: [],
				teamEnvironment: { environment: { name: "prod-fss" } },
				sqlInstances: { nodes: [] },
				postgresInstances: { nodes: [] },
				openSearch: null,
				buckets: { nodes: [] },
				valkeys: { nodes: [] },
				deployments: { nodes: [] },
			},
		]
		vi.stubGlobal(
			"fetch",
			mockFetchResponse({
				data: { team: { applications: { pageInfo: noMorePages, nodes } } },
			}),
		)

		const result = await fetchNaisApps("token", "my-team")
		expect(result[0].persistence).toEqual([{ type: "on_prem_postgres", name: "my-app-postgresql" }])
	})

	it("detects Entra ID login proxy (sidecar) from manifest", async () => {
		const manifest = `apiVersion: nais.io/v1alpha1
kind: Application
spec:
  azure:
    application:
      enabled: true
      allowAllUsers: true
    sidecar:
      enabled: true`

		const nodes = [
			{
				name: "sidecar-app",
				image: null,
				manifest: { content: manifest },
				authIntegrations: [{ name: "Microsoft Entra ID" }],
				teamEnvironment: { environment: { name: "prod-gcp" } },
				sqlInstances: { nodes: [] },
				postgresInstances: { nodes: [] },
				openSearch: null,
				buckets: { nodes: [] },
				valkeys: { nodes: [] },
				deployments: { nodes: [] },
			},
		]
		vi.stubGlobal(
			"fetch",
			mockFetchResponse({
				data: { team: { applications: { pageInfo: noMorePages, nodes } } },
			}),
		)

		const result = await fetchNaisApps("token", "my-team")
		const entra = result[0].authIntegrations.find((a) => a.type === "entra_id")
		expect(entra?.sidecarEnabled).toBe(true)
		expect(entra?.allowAllUsers).toBe(true)
	})

	it("detects ID-porten login proxy (sidecar) from manifest", async () => {
		const manifest = `apiVersion: nais.io/v1alpha1
kind: Application
spec:
  idporten:
    enabled: true
    sidecar:
      enabled: true`

		const nodes = [
			{
				name: "idporten-app",
				image: null,
				manifest: { content: manifest },
				authIntegrations: [{ name: "ID-porten" }],
				teamEnvironment: { environment: { name: "prod-gcp" } },
				sqlInstances: { nodes: [] },
				postgresInstances: { nodes: [] },
				openSearch: null,
				buckets: { nodes: [] },
				valkeys: { nodes: [] },
				deployments: { nodes: [] },
			},
		]
		vi.stubGlobal(
			"fetch",
			mockFetchResponse({
				data: { team: { applications: { pageInfo: noMorePages, nodes } } },
			}),
		)

		const result = await fetchNaisApps("token", "my-team")
		const idporten = result[0].authIntegrations.find((a) => a.type === "id_porten")
		expect(idporten?.sidecarEnabled).toBe(true)
	})

	it("detects sidecar not enabled when explicitly false", async () => {
		const manifest = `apiVersion: nais.io/v1alpha1
kind: Application
spec:
  azure:
    application:
      enabled: true
    sidecar:
      enabled: false`

		const nodes = [
			{
				name: "no-sidecar-app",
				image: null,
				manifest: { content: manifest },
				authIntegrations: [{ name: "Microsoft Entra ID" }],
				teamEnvironment: { environment: { name: "prod-gcp" } },
				sqlInstances: { nodes: [] },
				postgresInstances: { nodes: [] },
				openSearch: null,
				buckets: { nodes: [] },
				valkeys: { nodes: [] },
				deployments: { nodes: [] },
			},
		]
		vi.stubGlobal(
			"fetch",
			mockFetchResponse({
				data: { team: { applications: { pageInfo: noMorePages, nodes } } },
			}),
		)

		const result = await fetchNaisApps("token", "my-team")
		const entra = result[0].authIntegrations.find((a) => a.type === "entra_id")
		expect(entra?.sidecarEnabled).toBe(false)
	})

	it("extracts inbound access policy rules from manifest", async () => {
		const manifest = `apiVersion: nais.io/v1alpha1
kind: Application
spec:
  accessPolicy:
    inbound:
      rules:
        - application: app-a
        - application: app-b
          namespace: other-ns
        - application: app-c
          namespace: other-ns
          cluster: other-cluster
  azure:
    application:
      enabled: true`

		const nodes = [
			{
				name: "api-app",
				image: null,
				manifest: { content: manifest },
				authIntegrations: [{ name: "Microsoft Entra ID" }],
				teamEnvironment: { environment: { name: "prod-gcp" } },
				sqlInstances: { nodes: [] },
				postgresInstances: { nodes: [] },
				openSearch: null,
				buckets: { nodes: [] },
				valkeys: { nodes: [] },
				deployments: { nodes: [] },
			},
		]
		vi.stubGlobal(
			"fetch",
			mockFetchResponse({
				data: { team: { applications: { pageInfo: noMorePages, nodes } } },
			}),
		)

		const result = await fetchNaisApps("token", "my-team")
		const entra = result[0].authIntegrations.find((a) => a.type === "entra_id")
		expect(entra?.inboundRules).toEqual([
			{ application: "app-a" },
			{ application: "app-b", namespace: "other-ns" },
			{ application: "app-c", namespace: "other-ns", cluster: "other-cluster" },
		])
	})
})
