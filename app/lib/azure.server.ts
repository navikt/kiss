import type { NavUser } from "./auth.server"

const AZURE_OPENID_CONFIG_TOKEN_ENDPOINT = process.env.AZURE_OPENID_CONFIG_TOKEN_ENDPOINT
const AZURE_APP_CLIENT_ID = process.env.AZURE_APP_CLIENT_ID
const AZURE_APP_CLIENT_SECRET = process.env.AZURE_APP_CLIENT_SECRET

interface CachedToken {
	accessToken: string
	expiresAt: number
}

const CACHE_BUFFER_MS = 5 * 60 * 1000
const clientCredentialCache = new Map<string, CachedToken>()
const inflightRequests = new Map<string, Promise<string>>()

export async function getOnBehalfOfToken(user: NavUser, targetScope: string): Promise<string> {
	if (!AZURE_OPENID_CONFIG_TOKEN_ENDPOINT || !AZURE_APP_CLIENT_ID || !AZURE_APP_CLIENT_SECRET) {
		throw new Error("Azure AD environment variables not configured")
	}

	const response = await fetch(AZURE_OPENID_CONFIG_TOKEN_ENDPOINT, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
			client_id: AZURE_APP_CLIENT_ID,
			client_secret: AZURE_APP_CLIENT_SECRET,
			assertion: user.token,
			scope: targetScope,
			requested_token_use: "on_behalf_of",
		}),
	})

	if (!response.ok) {
		const text = await response.text()
		throw new Error(`OBO token request failed: ${response.status} ${text}`)
	}

	const data = (await response.json()) as { access_token: string }
	return data.access_token
}

export async function getClientCredentialToken(targetScope: string): Promise<string> {
	if (!AZURE_OPENID_CONFIG_TOKEN_ENDPOINT || !AZURE_APP_CLIENT_ID || !AZURE_APP_CLIENT_SECRET) {
		throw new Error("Azure AD environment variables not configured")
	}

	const cached = clientCredentialCache.get(targetScope)
	if (cached && cached.expiresAt > Date.now()) {
		return cached.accessToken
	}

	// Deduplicate concurrent requests for the same scope
	const inflight = inflightRequests.get(targetScope)
	if (inflight) {
		return inflight
	}

	const promise = fetchClientCredentialToken(targetScope)
	inflightRequests.set(targetScope, promise)

	try {
		return await promise
	} finally {
		inflightRequests.delete(targetScope)
	}
}

async function fetchClientCredentialToken(targetScope: string): Promise<string> {
	if (!AZURE_OPENID_CONFIG_TOKEN_ENDPOINT || !AZURE_APP_CLIENT_ID || !AZURE_APP_CLIENT_SECRET) {
		throw new Error("Azure AD environment variables not configured")
	}

	const response = await fetch(AZURE_OPENID_CONFIG_TOKEN_ENDPOINT, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "client_credentials",
			client_id: AZURE_APP_CLIENT_ID,
			client_secret: AZURE_APP_CLIENT_SECRET,
			scope: targetScope,
		}),
	})

	if (!response.ok) {
		const text = await response.text()
		throw new Error(`Client credential token request failed: ${response.status} ${text}`)
	}

	const data = (await response.json()) as { access_token: string; expires_in: number }

	const effectiveTtl = data.expires_in * 1000 - CACHE_BUFFER_MS
	if (effectiveTtl > 0) {
		clientCredentialCache.set(targetScope, {
			accessToken: data.access_token,
			expiresAt: Date.now() + effectiveTtl,
		})
	}

	return data.access_token
}
