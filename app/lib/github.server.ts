import crypto from "node:crypto"
import { importJWK, SignJWT } from "jose"
import { loggedFetch } from "./http-logger.server"
import { logger } from "./logger.server"

// --- Types ---

export interface GitHubTeam {
	slug: string
	name: string
	permission: string // admin, maintain, push, triage, pull
}

export interface GitHubCollaborator {
	login: string
	role_name: string // admin, maintain, write, triage, read
}

export interface GitHubTeamMember {
	login: string
	role: string // maintainer, member
}

// --- Token management ---

let cachedToken: { token: string; expiresAt: number } | null = null
let inflightTokenRequest: Promise<string> | null = null

function getConfig() {
	const appId = process.env.GITHUB_APP_ID
	const installationId = process.env.GITHUB_APP_INSTALLATION_ID
	const privateKey = process.env.GITHUB_APP_PRIVATE_KEY

	if (!appId || !installationId || !privateKey) {
		throw new Error(
			"Missing GitHub App configuration. Set GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, and GITHUB_APP_PRIVATE_KEY.",
		)
	}

	return { appId, installationId, privateKey }
}

async function generateJwt(): Promise<string> {
	const { appId, privateKey } = getConfig()

	// Handle private keys that use \n literal (from env vars)
	const pemKey = privateKey.replace(/\\n/g, "\n")

	// GitHub App private keys are PKCS#1 format. Use crypto.createPrivateKey
	// which handles both PKCS#1 and PKCS#8 formats, then export as JWK for jose.
	const keyObject = crypto.createPrivateKey(pemKey)
	const jwk = keyObject.export({ format: "jwk" })
	const key = await importJWK(jwk, "RS256")

	const now = Math.floor(Date.now() / 1000)
	return new SignJWT({})
		.setProtectedHeader({ alg: "RS256" })
		.setIssuer(appId)
		.setIssuedAt(now - 60) // 60s clock drift allowance
		.setExpirationTime(now + 10 * 60) // 10 minutes max
		.sign(key)
}

async function getInstallationToken(): Promise<string> {
	// Return cached token if still valid (>5 minutes remaining)
	if (cachedToken && cachedToken.expiresAt > Date.now() + 5 * 60 * 1000) {
		return cachedToken.token
	}

	// Deduplicate concurrent token requests
	if (inflightTokenRequest) {
		return inflightTokenRequest
	}

	inflightTokenRequest = fetchInstallationToken()
	try {
		return await inflightTokenRequest
	} finally {
		inflightTokenRequest = null
	}
}

async function fetchInstallationToken(): Promise<string> {
	const { installationId } = getConfig()
	const jwt = await generateJwt()

	const response = await loggedFetch(
		`https://api.github.com/app/installations/${installationId}/access_tokens`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${jwt}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
			},
		},
		{ area: "github" },
	)

	if (!response.ok) {
		const body = await response.text()
		throw new Error(`Failed to get installation token: ${response.status} ${body}`)
	}

	const data = (await response.json()) as { token: string; expires_at: string }
	cachedToken = {
		token: data.token,
		expiresAt: new Date(data.expires_at).getTime(),
	}

	return cachedToken.token
}

// --- Paginated fetch ---

async function fetchAllPages<T>(url: string): Promise<T[]> {
	const token = await getInstallationToken()
	const results: T[] = []
	let nextUrl: string | null = `${url}${url.includes("?") ? "&" : "?"}per_page=100`

	while (nextUrl) {
		const response = await loggedFetch(
			nextUrl,
			{
				headers: {
					Authorization: `token ${token}`,
					Accept: "application/vnd.github+json",
					"X-GitHub-Api-Version": "2022-11-28",
				},
			},
			{ area: "github" },
		)

		if (!response.ok) {
			const body = await response.text()
			throw new Error(`GitHub API error: ${response.status} ${nextUrl} – ${body}`)
		}

		const data = (await response.json()) as T[]
		results.push(...data)

		// Parse Link header for pagination
		const linkHeader = response.headers.get("link")
		nextUrl = parseLinkNext(linkHeader)
	}

	return results
}

export function parseLinkNext(linkHeader: string | null): string | null {
	if (!linkHeader) return null
	const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
	return match ? match[1] : null
}

// --- Public API ---

/**
 * Henter alle team som har tilgang til et repository.
 */
export async function getRepoTeams(owner: string, repo: string): Promise<GitHubTeam[]> {
	logger.debug(`[github] Fetching teams for ${owner}/${repo}`)
	const raw = await fetchAllPages<{ slug: string; name: string; permission: string }>(
		`https://api.github.com/repos/${owner}/${repo}/teams`,
	)
	return raw.map((t) => ({
		slug: t.slug,
		name: t.name,
		permission: t.permission,
	}))
}

/**
 * Henter alle collaborators med direkte tilgang til et repository.
 * Filtrerer bort de som kun har tilgang via team (affiliation=direct).
 */
export async function getRepoCollaborators(owner: string, repo: string): Promise<GitHubCollaborator[]> {
	logger.debug(`[github] Fetching collaborators for ${owner}/${repo}`)
	const raw = await fetchAllPages<{ login: string; role_name: string }>(
		`https://api.github.com/repos/${owner}/${repo}/collaborators?affiliation=direct`,
	)
	return raw.map((c) => ({
		login: c.login,
		role_name: c.role_name,
	}))
}

/**
 * Henter alle medlemmer av et GitHub-team (transitiv via org).
 */
export async function getTeamMembers(org: string, teamSlug: string): Promise<GitHubTeamMember[]> {
	logger.debug(`[github] Fetching members for team ${org}/${teamSlug}`)
	const raw = await fetchAllPages<{ login: string }>(`https://api.github.com/orgs/${org}/teams/${teamSlug}/members`)

	// GitHub team members endpoint doesn't include role directly,
	// we need to check membership for each or use the membership endpoint.
	// For efficiency, we'll fetch with role filter separately.
	const maintainers = await fetchAllPages<{ login: string }>(
		`https://api.github.com/orgs/${org}/teams/${teamSlug}/members?role=maintainer`,
	)
	const maintainerLogins = new Set(maintainers.map((m) => m.login))

	return raw.map((m) => ({
		login: m.login,
		role: maintainerLogins.has(m.login) ? "maintainer" : "member",
	}))
}

/**
 * Sjekker om GitHub App-konfigurasjonen er tilgjengelig.
 */
export function isGitHubAppConfigured(): boolean {
	return !!(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_INSTALLATION_ID && process.env.GITHUB_APP_PRIVATE_KEY)
}

/** Ugyldiggjør cached token (for testing). */
export function clearTokenCache(): void {
	cachedToken = null
	inflightTokenRequest = null
}
