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
