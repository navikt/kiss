import { getClientCredentialToken } from "./azure.server"
import { logger } from "./logger.server"

const GRAPH_SCOPE = "https://graph.microsoft.com/.default"

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
	const response = await fetch(`https://graph.microsoft.com/v1.0/groups/${groupId}?$select=displayName`, {
		headers: { Authorization: `Bearer ${token}` },
	})

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

		const response = await fetch("https://graph.microsoft.com/v1.0/$batch", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(batchBody),
		})

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

		const response = await fetch(url.toString(), {
			headers: {
				Authorization: `Bearer ${token}`,
				ConsistencyLevel: "eventual",
			},
		})

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
		const ident =
			trimmed
				.replace(/[^a-z0-9]/gi, "")
				.toUpperCase()
				.slice(0, 7) || "X000000"
		return [
			{ navIdent: ident, displayName: `${trimmed} Testbruker 1`, mail: `${ident.toLowerCase()}@nav.no` },
			{ navIdent: `${ident.slice(0, 6)}2`, displayName: `${trimmed} Testbruker 2`, mail: null },
		]
	}

	try {
		const token = await getClientCredentialToken(GRAPH_SCOPE)
		const escaped = trimmed.replace(/'/g, "''")
		const filterParts = [
			`startswith(displayName,'${escaped}')`,
			`startswith(givenName,'${escaped}')`,
			`startswith(surname,'${escaped}')`,
			`startswith(mail,'${escaped}')`,
			`startswith(userPrincipalName,'${escaped}')`,
		]
		const filter = filterParts.join(" or ")
		const url = new URL("https://graph.microsoft.com/v1.0/users")
		url.searchParams.set("$filter", filter)
		url.searchParams.set("$select", "id,displayName,mail,onPremisesSamAccountName,mailNickname")
		url.searchParams.set("$top", "10")
		url.searchParams.set("$orderby", "displayName")
		url.searchParams.set("$count", "true")

		const response = await fetch(url.toString(), {
			headers: {
				Authorization: `Bearer ${token}`,
				ConsistencyLevel: "eventual",
			},
		})

		if (!response.ok) {
			const body = await response.text().catch(() => "")
			logger.warn(`Graph user search failed: ${response.status}`, { body })
			return []
		}

		const data = (await response.json()) as { value: GraphUserInfo[] }
		const results: UserSearchResult[] = []
		for (const u of data.value) {
			const navIdent = pickNavIdent(u)
			if (!navIdent) continue
			results.push({ navIdent, displayName: u.displayName, mail: u.mail })
		}
		return results
	} catch (error) {
		logger.warn("Failed to search users from Microsoft Graph", { error: String(error) })
		return []
	}
}
