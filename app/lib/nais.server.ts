const NAIS_API_URL = process.env.NAIS_API_URL ?? "https://console.nav.cloud.nais.io/graphql"
const PAGE_SIZE = 100

export interface NaisTeam {
	slug: string
	purpose?: string
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
			apps(first: $first, after: $after) {
				pageInfo {
					hasNextPage
					endCursor
				}
				nodes {
					name
					namespace
					cluster
					image
					deployInfo {
						timestamp
						deployer
					}
				}
			}
		}
	}
`

interface AppsResponse {
	team: {
		apps: {
			pageInfo: PageInfo
			nodes: NaisApp[]
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
		allApps.push(...result.team.apps.nodes)

		hasMore = result.team.apps.pageInfo.hasNextPage
		after = result.team.apps.pageInfo.endCursor
	}

	return allApps
}
