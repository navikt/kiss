import type { NavUser } from "./auth.server"
import { loggedFetch } from "./http-logger.server"

const AZURE_OPENID_CONFIG_TOKEN_ENDPOINT = process.env.AZURE_OPENID_CONFIG_TOKEN_ENDPOINT
const AZURE_APP_CLIENT_ID = process.env.AZURE_APP_CLIENT_ID
const AZURE_APP_CLIENT_SECRET = process.env.AZURE_APP_CLIENT_SECRET

interface CachedToken {
	accessToken: string
	expiresAt: number
}

interface InflightTokenRequest {
	promise: Promise<string>
	controller: AbortController
	activeConsumers: number
	settled: boolean
}

const CACHE_BUFFER_MS = 5 * 60 * 1000
const clientCredentialCache = new Map<string, CachedToken>()
const inflightRequests = new Map<string, InflightTokenRequest>()

function waitForSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	signal.throwIfAborted()

	return new Promise((resolve, reject) => {
		const onAbort = () => reject(signal.reason)
		signal.addEventListener("abort", onAbort, { once: true })
		promise.then(
			(value) => {
				signal.removeEventListener("abort", onAbort)
				resolve(value)
			},
			(error) => {
				signal.removeEventListener("abort", onAbort)
				reject(error)
			},
		)
	})
}

export async function getOnBehalfOfToken(user: NavUser, targetScope: string): Promise<string> {
	if (!AZURE_OPENID_CONFIG_TOKEN_ENDPOINT || !AZURE_APP_CLIENT_ID || !AZURE_APP_CLIENT_SECRET) {
		throw new Error("Azure AD environment variables not configured")
	}

	const response = await loggedFetch(
		AZURE_OPENID_CONFIG_TOKEN_ENDPOINT,
		{
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
		},
		{ area: "azure-ad" },
	)

	if (!response.ok) {
		const text = await response.text()
		throw new Error(`OBO token request failed: ${response.status} ${text}`)
	}

	const data = (await response.json()) as { access_token: string }
	return data.access_token
}

export async function getClientCredentialToken(
	targetScope: string,
	options?: { signal?: AbortSignal },
): Promise<string> {
	if (!AZURE_OPENID_CONFIG_TOKEN_ENDPOINT || !AZURE_APP_CLIENT_ID || !AZURE_APP_CLIENT_SECRET) {
		throw new Error("Azure AD environment variables not configured")
	}
	options?.signal?.throwIfAborted()

	const cached = clientCredentialCache.get(targetScope)
	if (cached && cached.expiresAt > Date.now()) {
		return cached.accessToken
	}

	let request = inflightRequests.get(targetScope)
	if (!request) {
		const controller = new AbortController()
		const promise = fetchClientCredentialToken(targetScope, controller.signal)
		const createdRequest = { promise, controller, activeConsumers: 0, settled: false }
		request = createdRequest
		inflightRequests.set(targetScope, createdRequest)
		void promise.then(
			() => finishInflightRequest(targetScope, createdRequest),
			() => finishInflightRequest(targetScope, createdRequest),
		)
	}

	request.activeConsumers += 1
	try {
		return await (options?.signal ? waitForSignal(request.promise, options.signal) : request.promise)
	} finally {
		request.activeConsumers -= 1
		if (!request.settled && request.activeConsumers === 0) {
			if (inflightRequests.get(targetScope) === request) {
				inflightRequests.delete(targetScope)
			}
			request.controller.abort()
		}
	}
}

function finishInflightRequest(targetScope: string, request: InflightTokenRequest): void {
	request.settled = true
	if (inflightRequests.get(targetScope) === request) {
		inflightRequests.delete(targetScope)
	}
}

async function fetchClientCredentialToken(targetScope: string, signal: AbortSignal): Promise<string> {
	if (!AZURE_OPENID_CONFIG_TOKEN_ENDPOINT || !AZURE_APP_CLIENT_ID || !AZURE_APP_CLIENT_SECRET) {
		throw new Error("Azure AD environment variables not configured")
	}

	const response = await loggedFetch(
		AZURE_OPENID_CONFIG_TOKEN_ENDPOINT,
		{
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "client_credentials",
				client_id: AZURE_APP_CLIENT_ID,
				client_secret: AZURE_APP_CLIENT_SECRET,
				scope: targetScope,
			}),
			signal,
		},
		{ area: "azure-ad" },
	)

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
