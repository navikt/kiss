import { getClientCredentialToken } from "./azure.server"
import { loggedFetch } from "./http-logger.server"
import { logger } from "./logger.server"

const GRAPH_SCOPE = "https://graph.microsoft.com/.default"
const MAX_GRAPH_429_RETRIES = 3
const DEFAULT_429_BACKOFF_MS = 1000

function parseRetryAfterMs(retryAfter: string | null): number | null {
	if (!retryAfter) return null
	const seconds = Number(retryAfter)
	if (Number.isFinite(seconds) && seconds >= 0) {
		return Math.round(seconds * 1000)
	}

	const dateMs = Date.parse(retryAfter)
	if (Number.isNaN(dateMs)) return null
	return Math.max(0, dateMs - Date.now())
}

async function waitMs(ms: number): Promise<void> {
	if (ms <= 0) return
	await new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWith429Retry(url: string, initFactory: () => RequestInit, context: string): Promise<Response> {
	let attempt = 0
	for (;;) {
		const init = initFactory()
		const response = await loggedFetch(url, init, { area: "microsoft-graph" })
		if (response.status !== 429 || attempt >= MAX_GRAPH_429_RETRIES) {
			return response
		}

		const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"))
		const backoffMs = retryAfterMs ?? DEFAULT_429_BACKOFF_MS * 2 ** attempt
		logger.warn(`[graph] 429 for ${context}, retrying in ${backoffMs}ms (attempt ${attempt + 1})`)
		await response.body?.cancel()
		await waitMs(backoffMs)
		attempt++
	}
}

interface GraphGroupInfo {
	id: string
	displayName: string
}

const groupNameCache = new Map<string, string>()

/**
 * Resolve Azure AD group Object IDs to display names via Microsoft Graph API.
 * Returns a map of groupId → displayName. Unknown groups are omitted.
 * Results are cached in-memory for the lifetime of the process.
 */
export async function resolveGroupNames(groupIds: string[]): Promise<Record<string, string>> {
	if (groupIds.length === 0) return {}

	// Dev mode: return placeholder names
	if (!process.env.AZURE_OPENID_CONFIG_TOKEN_ENDPOINT) {
		const result: Record<string, string> = {}
		for (const id of groupIds) {
			result[id] = groupNameCache.get(id) ?? `Gruppe ${id.slice(0, 8)}…`
		}
		return result
	}

	const uncached = groupIds.filter((id) => !groupNameCache.has(id))
	if (uncached.length > 0) {
		try {
			const token = await getClientCredentialToken(GRAPH_SCOPE)
			// Use $batch for efficiency when resolving multiple groups
			if (uncached.length === 1) {
				const name = await fetchSingleGroupName(token, uncached[0])
				if (name) groupNameCache.set(uncached[0], name)
			} else {
				const names = await fetchGroupNamesBatch(token, uncached)
				for (const [id, name] of Object.entries(names)) {
					groupNameCache.set(id, name)
				}
			}
		} catch (error) {
			logger.warn("Failed to resolve group names from Microsoft Graph", { error: String(error) })
		}
	}

	const result: Record<string, string> = {}
	for (const id of groupIds) {
		const name = groupNameCache.get(id)
		if (name) result[id] = name
	}
	return result
}

async function fetchSingleGroupName(token: string, groupId: string): Promise<string | null> {
	const response = await loggedFetch(
		`https://graph.microsoft.com/v1.0/groups/${groupId}?$select=displayName`,
		{ headers: { Authorization: `Bearer ${token}` } },
		{ area: "microsoft-graph" },
	)

	if (!response.ok) {
		logger.warn(`Failed to fetch group name for ${groupId}: ${response.status}`)
		return null
	}

	const data = (await response.json()) as GraphGroupInfo
	return data.displayName
}

async function fetchGroupNamesBatch(token: string, groupIds: string[]): Promise<Record<string, string>> {
	// Microsoft Graph $batch supports up to 20 requests per batch
	const result: Record<string, string> = {}
	const batchSize = 20

	for (let i = 0; i < groupIds.length; i += batchSize) {
		const batch = groupIds.slice(i, i + batchSize)
		const batchBody = {
			requests: batch.map((id, idx) => ({
				id: String(idx),
				method: "GET",
				url: `/groups/${id}?$select=id,displayName`,
			})),
		}

		const response = await loggedFetch(
			"https://graph.microsoft.com/v1.0/$batch",
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(batchBody),
			},
			{ area: "microsoft-graph" },
		)

		if (!response.ok) {
			logger.warn(`Graph $batch request failed: ${response.status}`)
			continue
		}

		const data = (await response.json()) as {
			responses: Array<{
				id: string
				status: number
				body: GraphGroupInfo
			}>
		}

		for (const resp of data.responses) {
			if (resp.status === 200 && resp.body?.displayName) {
				result[resp.body.id] = resp.body.displayName
			}
		}
	}

	return result
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface GroupSearchResult {
	id: string
	displayName: string
}

/**
 * Search for Azure AD groups by name or Object ID.
 * If query looks like a UUID, does a direct lookup. Otherwise searches by displayName.
 */
export async function searchGroups(query: string): Promise<GroupSearchResult[]> {
	if (!query || query.length < 2) return []

	// Dev mode: return mock results
	if (!process.env.AZURE_OPENID_CONFIG_TOKEN_ENDPOINT) {
		if (UUID_REGEX.test(query)) {
			return [{ id: query, displayName: `Gruppe ${query.slice(0, 8)}…` }]
		}
		return [
			{ id: "00000000-0000-0000-0000-000000000001", displayName: `${query} - Testgruppe 1` },
			{ id: "00000000-0000-0000-0000-000000000002", displayName: `${query} - Testgruppe 2` },
		]
	}

	try {
		const token = await getClientCredentialToken(GRAPH_SCOPE)

		if (UUID_REGEX.test(query)) {
			const name = await fetchSingleGroupName(token, query)
			if (name) {
				groupNameCache.set(query, name)
				return [{ id: query, displayName: name }]
			}
			return []
		}

		const escaped = query.replace(/'/g, "''")
		const filter = `startswith(displayName,'${escaped}')`
		const url = new URL("https://graph.microsoft.com/v1.0/groups")
		url.searchParams.set("$filter", filter)
		url.searchParams.set("$select", "id,displayName")
		url.searchParams.set("$top", "10")
		url.searchParams.set("$orderby", "displayName")
		url.searchParams.set("$count", "true")

		const response = await loggedFetch(
			url.toString(),
			{ headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: "eventual" } },
			{ area: "microsoft-graph" },
		)

		if (!response.ok) {
			const body = await response.text().catch(() => "")
			logger.warn(`Graph group search failed: ${response.status}`, { body })
			return []
		}

		const data = (await response.json()) as { value: GraphGroupInfo[] }
		for (const g of data.value) {
			groupNameCache.set(g.id, g.displayName)
		}
		return data.value.map((g) => ({ id: g.id, displayName: g.displayName }))
	} catch (error) {
		logger.warn("Failed to search groups from Microsoft Graph", { error: String(error) })
		return []
	}
}

export interface UserSearchResult {
	navIdent: string
	displayName: string
	mail: string | null
}

interface GraphUserInfo {
	id: string
	displayName: string
	mail: string | null
	onPremisesSamAccountName: string | null
	mailNickname: string | null
}

function pickNavIdent(u: GraphUserInfo): string | null {
	const candidate = u.onPremisesSamAccountName ?? u.mailNickname
	if (!candidate) return null
	const trimmed = candidate.trim()
	return trimmed.length > 0 ? trimmed : null
}

/**
 * Search for Azure AD users by display name. Returns up to 10 users with their
 * NAVident (read from onPremisesSamAccountName, falling back to mailNickname),
 * display name and mail. Users without a resolvable NAVident are omitted.
 */
export async function searchUsers(query: string): Promise<UserSearchResult[]> {
	const trimmed = query.trim()
	if (trimmed.length < 2) return []

	if (!process.env.AZURE_OPENID_CONFIG_TOKEN_ENDPOINT) {
		const nodeEnv = process.env.NODE_ENV
		const allowMockResults = nodeEnv === "development" || nodeEnv === "test"
		if (!allowMockResults) {
			logger.warn(
				"searchUsers: AZURE_OPENID_CONFIG_TOKEN_ENDPOINT is not set outside development/test – returning empty result",
				{
					nodeEnv: nodeEnv ?? "undefined",
				},
			)
			return []
		}
		const ident =
			trimmed
				.replace(/[^a-z0-9]/gi, "")
				.toUpperCase()
				.slice(0, 7) || "X000000"
		const ident2 = `${ident.slice(0, 6)}2`
		const mockUsers: GraphUserInfo[] = [
			{
				id: "00000000-0000-0000-0000-000000000001",
				displayName: `${trimmed} Testbruker 1`,
				mail: `${ident.toLowerCase()}@nav.no`,
				onPremisesSamAccountName: ident,
				mailNickname: ident.toLowerCase(),
			},
			{
				id: "00000000-0000-0000-0000-000000000002",
				displayName: `${trimmed} Testbruker 2`,
				mail: null,
				onPremisesSamAccountName: null,
				mailNickname: ident2.toLowerCase(),
			},
		]
		return mapGraphUsersToResults(mockUsers)
	}

	try {
		const url = new URL("https://graph.microsoft.com/v1.0/users")
		url.searchParams.set("$select", "id,displayName,mail,onPremisesSamAccountName,mailNickname")
		url.searchParams.set("$top", "10")
		url.searchParams.set("$count", "true")

		if (/^[A-Za-z]\d{6}$/.test(trimmed)) {
			const identUpper = trimmed.toUpperCase().replace(/'/g, "''")
			const identLower = trimmed.toLowerCase().replace(/'/g, "''")
			url.searchParams.set("$filter", `onPremisesSamAccountName eq '${identUpper}' or mailNickname eq '${identLower}'`)
		} else {
			const words = trimmed
				.replace(/[^a-zA-Z0-9æøåÆØÅ]/g, " ")
				.split(/\s+/)
				.filter(Boolean)
			if (words.length === 0) return []
			const search = words.map((w) => `"displayName:${w}"`).join(" ")
			url.searchParams.set("$search", search)
		}

		const token = await getClientCredentialToken(GRAPH_SCOPE)
		const response = await loggedFetch(
			url.toString(),
			{ headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: "eventual" } },
			{ area: "microsoft-graph" },
		)

		if (!response.ok) {
			const body = await response.text().catch(() => "")
			logger.warn(`Graph user search failed: ${response.status}`, { body })
			return []
		}

		const data = (await response.json()) as { value: GraphUserInfo[] }
		return mapGraphUsersToResults(data.value)
	} catch (error) {
		logger.warn("Failed to search users from Microsoft Graph", { error: String(error) })
		return []
	}
}

function mapGraphUsersToResults(users: GraphUserInfo[]): UserSearchResult[] {
	const results: UserSearchResult[] = []
	for (const u of users) {
		const navIdent = pickNavIdent(u)
		if (!navIdent) continue
		results.push({ navIdent, displayName: u.displayName, mail: u.mail })
	}
	return results
}

/**
 * Look up a single user by NAV-ident in Microsoft Graph.
 * Returns null if the user does not exist.
 * Throws if the Graph API is unavailable or returns an error response.
 */
export async function getUserByNavIdent(navIdent: string): Promise<UserSearchResult | null> {
	const trimmed = navIdent.trim()

	if (!process.env.AZURE_OPENID_CONFIG_TOKEN_ENDPOINT) {
		const nodeEnv = process.env.NODE_ENV
		if (nodeEnv !== "development" && nodeEnv !== "test") {
			throw new Error("AZURE_OPENID_CONFIG_TOKEN_ENDPOINT is not configured")
		}
		const ident = trimmed.toUpperCase()
		return { navIdent: ident, displayName: `${ident} Testbruker`, mail: `${ident.toLowerCase()}@nav.no` }
	}

	const url = new URL("https://graph.microsoft.com/v1.0/users")
	url.searchParams.set("$select", "id,displayName,mail,onPremisesSamAccountName,mailNickname")
	url.searchParams.set("$top", "1")
	url.searchParams.set("$count", "true")
	const identUpper = trimmed.toUpperCase().replace(/'/g, "''")
	const identLower = trimmed.toLowerCase().replace(/'/g, "''")
	url.searchParams.set("$filter", `onPremisesSamAccountName eq '${identUpper}' or mailNickname eq '${identLower}'`)

	const token = await getClientCredentialToken(GRAPH_SCOPE)
	const response = await loggedFetch(
		url.toString(),
		{ headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: "eventual" } },
		{ area: "microsoft-graph" },
	)

	if (!response.ok) {
		const body = await response.text().catch(() => "")
		logger.warn(`Graph getUserByNavIdent failed: ${response.status}`, { navIdent: trimmed, body })
		throw new Error(`Microsoft Graph returnerte ${response.status} ved oppslag av bruker`)
	}

	const data = (await response.json()) as { value: GraphUserInfo[] }
	const results = mapGraphUsersToResults(data.value)
	return results.find((r) => r.navIdent.toUpperCase() === trimmed.toUpperCase()) ?? null
}

// ─── Group Member Listing ─────────────────────────────────────────────────────

export interface GroupMember {
	userObjectId: string
	displayName: string | null
	userPrincipalName: string | null
	accountEnabled: boolean | null
}

interface GraphMemberResponse {
	value: Array<{
		"@odata.type": string
		id: string
		displayName?: string
		userPrincipalName?: string
		accountEnabled?: boolean
	}>
	"@odata.nextLink"?: string
}

/**
 * Fetch all direct members of an Entra ID group via Microsoft Graph API.
 * Only returns user objects (filters out nested groups, service principals, etc.).
 * Handles pagination automatically.
 */
export async function fetchGroupMembers(groupId: string): Promise<GroupMember[]> {
	if (!process.env.AZURE_OPENID_CONFIG_TOKEN_ENDPOINT) {
		const nodeEnv = process.env.NODE_ENV
		if (nodeEnv !== "development" && nodeEnv !== "test") {
			throw new Error("AZURE_OPENID_CONFIG_TOKEN_ENDPOINT is not configured")
		}
		return [
			{
				userObjectId: "00000000-0000-0000-0000-000000000001",
				displayName: "RPA Robot Testbruker 1",
				userPrincipalName: "rpa-robot-1@nav.no",
				accountEnabled: true,
			},
			{
				userObjectId: "00000000-0000-0000-0000-000000000002",
				displayName: "RPA Robot Testbruker 2",
				userPrincipalName: "rpa-robot-2@nav.no",
				accountEnabled: false,
			},
		]
	}

	const token = await getClientCredentialToken(GRAPH_SCOPE)
	const members: GroupMember[] = []
	let url: string | null =
		`https://graph.microsoft.com/v1.0/groups/${groupId}/members?$select=id,displayName,userPrincipalName,accountEnabled&$top=100`

	while (url) {
		const response = await fetchWith429Retry(
			url,
			() => ({
				headers: { Authorization: `Bearer ${token}` },
				signal: AbortSignal.timeout(30_000),
			}),
			`group members ${groupId}`,
		)

		if (!response.ok) {
			throw new Error(`Graph group members request failed for ${groupId}: ${response.status}`)
		}

		const data = (await response.json()) as GraphMemberResponse
		const memberList = data?.value
		if (!Array.isArray(memberList)) {
			throw new Error(`Unexpected Graph API response for group ${groupId}: missing value array`)
		}

		for (const member of memberList) {
			if (member["@odata.type"] !== "#microsoft.graph.user") continue
			members.push({
				userObjectId: member.id,
				displayName: member.displayName ?? null,
				userPrincipalName: member.userPrincipalName ?? null,
				accountEnabled: member.accountEnabled ?? null,
			})
		}

		url = data["@odata.nextLink"] ?? null
	}

	return members
}

// ─── User Group Memberships ──────────────────────────────────────────────────

export interface UserGroupMembership {
	groupId: string
	displayName: string | null
}

interface GraphMemberOfResponse {
	value: Array<{
		"@odata.type": string
		id: string
		displayName?: string
	}>
	"@odata.nextLink"?: string
}

/**
 * Fetch all Entra ID group memberships for a user via Microsoft Graph API.
 * Returns only security groups and Microsoft 365 groups (filters out other directory objects).
 * Handles pagination automatically.
 */
export async function fetchUserGroupMemberships(userObjectId: string): Promise<UserGroupMembership[]> {
	if (!process.env.AZURE_OPENID_CONFIG_TOKEN_ENDPOINT) {
		const nodeEnv = process.env.NODE_ENV
		if (nodeEnv !== "development" && nodeEnv !== "test") {
			throw new Error("AZURE_OPENID_CONFIG_TOKEN_ENDPOINT is not configured")
		}
		// Dev mode: return mock group memberships
		return [
			{ groupId: "mock-group-1", displayName: "Mock Nais-gruppe 1" },
			{ groupId: "mock-group-2", displayName: "Mock Nais-gruppe 2" },
		]
	}

	const token = await getClientCredentialToken(GRAPH_SCOPE)
	const groups: UserGroupMembership[] = []
	let url: string | null =
		`https://graph.microsoft.com/v1.0/users/${userObjectId}/memberOf?$select=id,displayName&$top=100`

	while (url) {
		const response = await fetchWith429Retry(
			url,
			() => ({
				headers: { Authorization: `Bearer ${token}` },
				signal: AbortSignal.timeout(30_000),
			}),
			`user memberOf ${userObjectId}`,
		)

		if (!response.ok) {
			throw new Error(`Graph memberOf request failed for user ${userObjectId}: ${response.status}`)
		}

		const data = (await response.json()) as GraphMemberOfResponse
		const memberList = data?.value
		if (!Array.isArray(memberList)) {
			throw new Error(`Unexpected Graph API response for user ${userObjectId} memberOf: missing value array`)
		}

		for (const item of memberList) {
			if (item["@odata.type"] !== "#microsoft.graph.group") continue
			groups.push({
				groupId: item.id,
				displayName: item.displayName ?? null,
			})
		}

		url = data["@odata.nextLink"] ?? null
	}

	return groups
}

export const _testing = {
	parseRetryAfterMs,
}
