const NAIS_API_URL = process.env.NAIS_API_URL ?? "https://console.nav.cloud.nais.io/graphql"
const PAGE_SIZE = 100

export interface NaisTeam {
	slug: string
	purpose?: string
}

export interface NaisPersistenceResource {
	type: "cloud_sql_postgres" | "nais_postgres" | "on_prem_postgres" | "opensearch" | "bucket" | "valkey" | "oracle"
	name: string
	version?: string
	tier?: string
	highAvailability?: boolean
	auditLogging?: boolean
	auditLogUrl?: string
	flags?: Record<string, string>
}

export interface NaisAuthIntegration {
	type: "entra_id" | "token_x" | "id_porten" | "maskinporten"
	enabled: boolean
	allowAllUsers?: boolean
	claimsExtra?: string[]
	groups?: string[]
	sidecarEnabled?: boolean
}

export interface NaisApp {
	name: string
	namespace: string
	cluster: string
	image?: string
	deployInfo?: {
		timestamp: string
		deployer: string
	}
	persistence: NaisPersistenceResource[]
	authIntegrations: NaisAuthIntegration[]
}

interface PageInfo {
	hasNextPage: boolean
	endCursor: string | null
}

interface GraphQLResponse<T> {
	data?: T
	errors?: Array<{ message: string }>
}

/** Get the Nais API token. Returns undefined when using a local proxy (no auth needed). */
export function getNaisToken(): string | undefined {
	return process.env.NAIS_API_TOKEN || undefined
}

async function naisGraphQL<T>(query: string, variables?: Record<string, unknown>, token?: string): Promise<T> {
	const headers: Record<string, string> = { "Content-Type": "application/json" }
	if (token) {
		headers.Authorization = `Bearer ${token}`
	}

	const response = await fetch(NAIS_API_URL, {
		method: "POST",
		headers,
		body: JSON.stringify({ query, variables }),
	})

	if (!response.ok) {
		const text = await response.text()
		throw new Error(`Nais API request failed: ${response.status} ${text}`)
	}

	const json = (await response.json()) as GraphQLResponse<T>

	if (json.errors?.length) {
		throw new Error(`Nais GraphQL errors: ${json.errors.map((e) => e.message).join(", ")}`)
	}

	if (!json.data) {
		throw new Error("Nais API returned no data")
	}

	return json.data
}

const TEAMS_QUERY = `
	query Teams($first: Int!, $after: Cursor) {
		teams(first: $first, after: $after) {
			pageInfo {
				hasNextPage
				endCursor
			}
			nodes {
				slug
				purpose
			}
		}
	}
`

interface TeamsResponse {
	teams: {
		pageInfo: PageInfo
		nodes: NaisTeam[]
	}
}

export async function fetchNaisTeams(token?: string): Promise<NaisTeam[]> {
	const allTeams: NaisTeam[] = []
	let after: string | null = null
	let hasMore = true

	while (hasMore) {
		const variables: Record<string, unknown> = { first: PAGE_SIZE }
		if (after) variables.after = after

		const result = await naisGraphQL<TeamsResponse>(TEAMS_QUERY, variables, token)
		allTeams.push(...result.teams.nodes)

		hasMore = result.teams.pageInfo.hasNextPage
		after = result.teams.pageInfo.endCursor
	}

	console.log(`[nais] Fetched ${allTeams.length} teams (${Math.ceil(allTeams.length / PAGE_SIZE)} pages)`)
	return allTeams
}

const APPS_QUERY = `
	query TeamApps($slug: Slug!, $first: Int!, $after: Cursor) {
		team(slug: $slug) {
			applications(first: $first, after: $after) {
				pageInfo {
					hasNextPage
					endCursor
				}
				nodes {
					name
					image {
						name
					}
					manifest {
						content
					}
					authIntegrations {
						... on EntraIDAuthIntegration { name }
						... on TokenXAuthIntegration { name }
						... on IDPortenAuthIntegration { name }
						... on MaskinportenAuthIntegration { name }
					}
					teamEnvironment {
						environment {
							name
						}
					}
					sqlInstances {
						nodes {
							name
							version
							tier
							highAvailability
							auditLog {
								logUrl
							}
							flags {
								nodes {
									name
									value
								}
							}
						}
					}
					postgresInstances {
						nodes {
							name
							majorVersion
							highAvailability
						}
					}
					openSearch {
						name
					}
					buckets {
						nodes {
							name
						}
					}
					valkeys {
						nodes {
							name
						}
					}
				}
			}
		}
	}
`

interface AppsResponse {
	team: {
		applications: {
			pageInfo: PageInfo
			nodes: Array<{
				name: string
				image: { name: string } | null
				manifest: { content: string } | null
				authIntegrations: Array<{ name: string }>
				teamEnvironment: {
					environment: {
						name: string
					}
				}
				sqlInstances: {
					nodes: Array<{
						name: string
						version: string
						tier: string
						highAvailability: boolean
						auditLog: { logUrl: string } | null
						flags: {
							nodes: Array<{ name: string; value: string }>
						}
					}>
				}
				postgresInstances: {
					nodes: Array<{
						name: string
						majorVersion: string
						highAvailability: boolean
					}>
				}
				openSearch: { name: string } | null
				buckets: {
					nodes: Array<{ name: string }>
				}
				valkeys: {
					nodes: Array<{ name: string }>
				}
			}>
		}
	}
}

export async function fetchNaisApps(token: string | undefined, teamSlug: string): Promise<NaisApp[]> {
	const allApps: NaisApp[] = []
	let after: string | null = null
	let hasMore = true

	while (hasMore) {
		const variables: Record<string, unknown> = { slug: teamSlug, first: PAGE_SIZE }
		if (after) variables.after = after

		const result = await naisGraphQL<AppsResponse>(APPS_QUERY, variables, token)
		for (const node of result.team.applications.nodes) {
			const persistence: NaisPersistenceResource[] = []

			for (const sql of node.sqlInstances.nodes) {
				const flagMap: Record<string, string> = {}
				for (const f of sql.flags.nodes) {
					flagMap[f.name] = f.value
				}
				const pgAuditEnabled =
					flagMap["cloudsql.enable_pgaudit"] === "on" || flagMap["cloudsql.enable_pgaudit"] === "true"

				persistence.push({
					type: "cloud_sql_postgres",
					name: sql.name,
					version: sql.version,
					tier: sql.tier,
					highAvailability: sql.highAvailability,
					auditLogging: pgAuditEnabled,
					auditLogUrl: sql.auditLog?.logUrl,
					flags: Object.keys(flagMap).length > 0 ? flagMap : undefined,
				})
			}

			for (const pg of node.postgresInstances.nodes) {
				persistence.push({
					type: "nais_postgres",
					name: pg.name,
					version: pg.majorVersion,
					highAvailability: pg.highAvailability,
				})
			}

			if (node.openSearch) {
				persistence.push({
					type: "opensearch",
					name: node.openSearch.name,
				})
			}

			for (const bucket of node.buckets.nodes) {
				persistence.push({
					type: "bucket",
					name: bucket.name,
				})
			}

			for (const valkey of node.valkeys.nodes) {
				persistence.push({
					type: "valkey",
					name: valkey.name,
				})
			}

			// Detect Oracle databases from vault paths in the manifest
			if (node.manifest?.content) {
				const oraclePaths = node.manifest.content.match(/kvPath:\s*(oracle\/data\/[^\s]+)/g)
				if (oraclePaths) {
					// Extract unique database names from vault creds paths (oracle/data/{env}/creds/{db}-{user})
					const dbNames = new Set<string>()
					for (const match of oraclePaths) {
						const path = match.replace("kvPath:", "").trim()
						const credsMatch = path.match(/oracle\/data\/[^/]+\/creds\/([^-\s]+)/)
						if (credsMatch) {
							dbNames.add(credsMatch[1])
						}
					}
					for (const dbName of dbNames) {
						persistence.push({
							type: "oracle",
							name: dbName,
						})
					}
				}
			}

			// Detect on-prem PostgreSQL from envFrom secrets in manifest
			if (node.manifest?.content) {
				const secretMatches = node.manifest.content.match(/-\s*secret:\s*([^\s]+)/g)
				if (secretMatches) {
					for (const match of secretMatches) {
						const secretName = match.replace(/-\s*secret:\s*/, "").trim()
						if (/postgres(?:ql)?$/i.test(secretName)) {
							// Avoid duplicates if already detected as cloud_sql or nais postgres
							const alreadyHasPostgres = persistence.some(
								(p) => p.type === "cloud_sql_postgres" || p.type === "nais_postgres",
							)
							if (!alreadyHasPostgres) {
								persistence.push({
									type: "on_prem_postgres",
									name: secretName,
								})
							}
							break
						}
					}
				}
			}

			// Extract auth integrations from GraphQL + manifest details
			const authIntegrations: NaisAuthIntegration[] = []
			const authNames = new Set(node.authIntegrations.map((a) => a.name))
			const manifestContent = node.manifest?.content ?? ""

			if (authNames.has("Microsoft Entra ID")) {
				const allowAllMatch = manifestContent.match(/allowAllUsers:\s*(true|false)/)
				const claimsExtraMatch = manifestContent.match(/claims:\s*\n\s*extra:\s*\n((?:\s*-\s*\S+\n?)*)/)
				const claimsExtra = claimsExtraMatch
					? claimsExtraMatch[1]
							.split("\n")
							.map((l) => l.replace(/^\s*-\s*/, "").trim())
							.filter(Boolean)
					: undefined

				// Extract required group IDs from manifest
				const groupsMatch = manifestContent.match(/groups:\s*\n((?:\s*-\s*id:\s*[0-9a-f-]+\n?)*)/)
				const groups = groupsMatch
					? groupsMatch[1]
							.split("\n")
							.map((l) => l.replace(/^\s*-\s*id:\s*/, "").trim())
							.filter(Boolean)
					: undefined

				// Detect login proxy (sidecar) for Entra ID
				const azureSidecarMatch = manifestContent.match(
					/azure:\s*\n(?:.*\n)*?\s*sidecar:\s*\n\s*enabled:\s*(true|false)/,
				)
				const azureSidecarEnabled = azureSidecarMatch ? azureSidecarMatch[1] === "true" : undefined

				authIntegrations.push({
					type: "entra_id",
					enabled: true,
					allowAllUsers: allowAllMatch ? allowAllMatch[1] === "true" : undefined,
					claimsExtra: claimsExtra?.length ? claimsExtra : undefined,
					groups: groups?.length ? groups : undefined,
					sidecarEnabled: azureSidecarEnabled,
				})
			}

			if (authNames.has("TokenX")) {
				authIntegrations.push({ type: "token_x", enabled: true })
			}

			if (authNames.has("ID-porten") || manifestContent.includes("idporten:")) {
				// Detect login proxy (sidecar) for ID-porten
				const idportenSidecarMatch = manifestContent.match(
					/idporten:\s*\n(?:.*\n)*?\s*sidecar:\s*\n\s*enabled:\s*(true|false)/,
				)
				const idportenSidecarEnabled = idportenSidecarMatch ? idportenSidecarMatch[1] === "true" : undefined

				authIntegrations.push({
					type: "id_porten",
					enabled: true,
					sidecarEnabled: idportenSidecarEnabled,
				})
			}

			if (authNames.has("Maskinporten")) {
				authIntegrations.push({ type: "maskinporten", enabled: true })
			}

			allApps.push({
				name: node.name,
				namespace: teamSlug,
				cluster: node.teamEnvironment.environment.name,
				image: node.image?.name,
				persistence,
				authIntegrations,
			})
		}

		hasMore = result.team.applications.pageInfo.hasNextPage
		after = result.team.applications.pageInfo.endCursor
	}

	return allApps
}
