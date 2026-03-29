const NAIS_API_URL = process.env.NAIS_API_URL ?? "https://console.nav.cloud.nais.io/graphql"

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
	query {
		teams {
			nodes {
				slug
				purpose
			}
		}
	}
`

interface TeamsResponse {
	teams: {
		nodes: NaisTeam[]
	}
}

export async function fetchNaisTeams(token?: string): Promise<NaisTeam[]> {
	const data = await naisGraphQL<TeamsResponse>(TEAMS_QUERY, undefined, token)
	return data.teams.nodes
}

const APPS_QUERY = `
	query TeamApps($slug: Slug!) {
		team(slug: $slug) {
			apps {
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
			nodes: NaisApp[]
		}
	}
}

export async function fetchNaisApps(token: string | undefined, teamSlug: string): Promise<NaisApp[]> {
	const data = await naisGraphQL<AppsResponse>(APPS_QUERY, { slug: teamSlug }, token)
	return data.team.apps.nodes
}
