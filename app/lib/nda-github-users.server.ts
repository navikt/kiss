import { z } from "zod"
import { getClientCredentialToken } from "./azure.server"
import { loggedFetch } from "./http-logger.server"
import { logger } from "./logger.server"

const NDA_SCOPE = process.env.NDA_AUDIT_REPORTS_SCOPE ?? process.env.DEPLOYMENT_AUDIT_SCOPE
const NDA_BASE_URL = process.env.NDA_AUDIT_REPORTS_BASE_URL ?? process.env.DEPLOYMENT_AUDIT_BASE_URL
const MAX_USERNAMES_PER_REQUEST = 500
const MAX_CONCURRENT_REQUESTS = 3
const REQUEST_TIMEOUT_MS = 5_000

const githubUserLookupResultSchema = z.object({
	githubUsername: z.string(),
	displayName: z.string().nullable(),
	navIdent: z.string().nullable(),
	found: z.boolean(),
})

const githubUserLookupResponseSchema = z.object({
	users: z.array(githubUserLookupResultSchema),
})

export type GitHubUserLookupResult = z.infer<typeof githubUserLookupResultSchema>

async function lookupBatch(
	githubUsernames: string[],
	token: string,
	requestSignal?: AbortSignal,
): Promise<GitHubUserLookupResult[]> {
	const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	const signal = requestSignal ? AbortSignal.any([requestSignal, timeoutSignal]) : timeoutSignal
	const response = await loggedFetch(
		`${NDA_BASE_URL}/api/v1/users/github-lookup`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ githubUsernames }),
			signal,
		},
		{ area: "nda-github-users" },
	)

	if (!response.ok) {
		await response.text()
		logger.error("NDA GitHub user lookup failed", { status: response.status })
		throw new Error(`NDA GitHub user lookup failed: ${response.status}`)
	}

	return githubUserLookupResponseSchema.parse(await response.json()).users
}

export async function lookupGitHubUsers(
	githubUsernames: string[],
	options?: { signal?: AbortSignal },
): Promise<Map<string, GitHubUserLookupResult>> {
	const uniqueUsernames = [...new Set(githubUsernames.map((username) => username.trim()).filter(Boolean))]
	if (uniqueUsernames.length === 0) {
		return new Map()
	}
	if (!NDA_SCOPE) {
		throw new Error("NDA_AUDIT_REPORTS_SCOPE is not configured")
	}
	if (!NDA_BASE_URL) {
		throw new Error("NDA_AUDIT_REPORTS_BASE_URL is not configured")
	}

	const batches: string[][] = []
	for (let index = 0; index < uniqueUsernames.length; index += MAX_USERNAMES_PER_REQUEST) {
		batches.push(uniqueUsernames.slice(index, index + MAX_USERNAMES_PER_REQUEST))
	}

	const tokenTimeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	const tokenSignal = options?.signal ? AbortSignal.any([options.signal, tokenTimeoutSignal]) : tokenTimeoutSignal
	const token = await getClientCredentialToken(NDA_SCOPE, { signal: tokenSignal })
	const responses: GitHubUserLookupResult[][] = []
	for (let index = 0; index < batches.length; index += MAX_CONCURRENT_REQUESTS) {
		const requestGroup = batches.slice(index, index + MAX_CONCURRENT_REQUESTS)
		responses.push(...(await Promise.all(requestGroup.map((batch) => lookupBatch(batch, token, options?.signal)))))
	}
	return new Map(responses.flat().map((user) => [user.githubUsername, user]))
}
